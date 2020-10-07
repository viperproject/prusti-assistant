import * as vscode from "vscode";
import { performance } from "perf_hooks";
import * as config from "./config";
import * as util from "./util";
import * as diagnostics from "./diagnostics";
import * as checks from "./checks";
import { prusti, installDependencies, ensureRustToolchainInstalled } from "./dependencies";
import { serverAddress, restartServer } from "./server";
import * as state from "./state";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    util.log("Start Prusti Assistant");

    // Download dependencies
    util.log("Checking dependencies...");
    await installDependencies(context, false);

    // Prerequisites checks
    util.log("Checking prerequisites...");
    const [hasPrerequisites, errorMessage] = await checks.hasPrerequisites(prusti!);
    if (!hasPrerequisites) {
        util.userError("Prusti Assistant's prerequisites are not satisfied.", false);
        util.userError(errorMessage, true, true);
        util.log("Stopping plugin. Reload the IDE to retry.");
        return;
    } else {
        util.log("Prerequisites are satisfied.");
    }

    // Install Rust toolchain
    await ensureRustToolchainInstalled(context, await prusti!.rustToolchainVersion());

    // Start the server
    await restartServer(context);

    // Update dependencies on command
    context.subscriptions.push(
        vscode.commands.registerCommand("prusti-assistant.update", async () => {
            await installDependencies(context, true);
        })
    );

    // Restart the server on command
    context.subscriptions.push(
        vscode.commands.registerCommand("prusti-assistant.restart-server", restartServer)
    );

    // Update dependencies on config change
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(async event => {
            const hasChangedChannel = event.affectsConfiguration(config.buildChannelPath);
            const hasChangedLocation = (
                config.buildChannel() === config.BuildChannel.Local
                && event.affectsConfiguration(config.localPrustiPathPath)
            );
            if (hasChangedChannel || hasChangedLocation) {
                util.log("Install the dependencies because the configuration changed...");
                await installDependencies(context, false);
            }
            const hasChangedServer = event.affectsConfiguration(config.serverAddressPath);
            if (hasChangedServer) {
                util.log("Restart the server because the configuration changed...");
                await restartServer(context);
            }
        })
    );

    // Shared collection of diagnostics
    const prustiProgramDiagnostics = vscode.languages.createDiagnosticCollection("prusti-program");
    const prustiCratesDiagnostics = vscode.languages.createDiagnosticCollection("prusti-crates");

    // Define verification function
    async function runVerification(document: vscode.TextDocument) {
        util.log("Run verification...");

        switch (config.verificationMode()) {
            case config.VerificationMode.CurrentProgram: {
                // Verify provided document
                if (document.languageId !== "rust") {
                    util.log(
                        `The document is not a Rust program (${document.languageId}), thus Prusti will not run on it.`
                    );
                    break;
                }

                if (serverAddress === undefined) {
                    // Just warn, as Prusti can run without a server.
                    util.userWarn(
                        "Prusti might run slower than usual because the Prusti server is not running."
                    );
                }

                vscode.window.setStatusBarMessage("$(loading~spin) Running Prusti...");
                const start = performance.now();

                const programDiagnostics = await diagnostics.generatesProgramDiagnostics(
                    prusti!,
                    document.uri.fsPath,
                    serverAddress
                );
                programDiagnostics.render(prustiProgramDiagnostics);

                const counts = programDiagnostics.countsBySeverity();
                const duration = Math.round((performance.now() - start) / 100) / 10;
                if (programDiagnostics.hasErrors()) {
                    const errors = counts.get(vscode.DiagnosticSeverity.Error);
                    const noun = errors === 1 ? "error" : "errors";
                    vscode.window.setStatusBarMessage(`$(error) Verification failed with ${errors} ${noun} (${duration} s)`);
                } else if (programDiagnostics.hasWarnings()) {
                    const warnings = counts.get(vscode.DiagnosticSeverity.Error);
                    const noun = warnings === 1 ? "warning" : "warnings";
                    vscode.window.setStatusBarMessage(`$(warning) Verification succeeded with ${warnings} ${noun} (${duration} s)`);
                } else {
                    vscode.window.setStatusBarMessage(`$(check) Verification succeeded (${duration} s)`);
                }
                break;
            }
            case config.VerificationMode.AllCratesInWorkspace: {
                // Verify all crates in workspace
                vscode.window.setStatusBarMessage("Running Prusti...");
                const start = performance.now();

                const projects = await util.findProjects();
                if (!projects.hasProjects()) {
                    void vscode.window.showWarningMessage(
                        "Prusti Assistant: No 'Cargo.toml' files were found in the workspace."
                    );
                }

                const crateDiagnostics = await diagnostics.generatesCratesDiagnostics(prusti!, projects);
                crateDiagnostics.render(prustiCratesDiagnostics);

                const duration = Math.round((performance.now() - start) / 100) / 10;
                if (crateDiagnostics.hasErrors()) {
                    vscode.window.setStatusBarMessage(`Verification of some crate failed (${duration} s)`);
                } else if (crateDiagnostics.hasWarnings()) {
                    vscode.window.setStatusBarMessage(`Verification of all crates succeeded with warnings (${duration} s)`);
                } else {
                    vscode.window.setStatusBarMessage(`Verification of all crates succeeded (${duration} s)`);
                }
                break;
            }
        }
    }

    const verifyCommand = "prusti-assistant.verify";
    // Verify on command
    context.subscriptions.push(
        vscode.commands.registerCommand(verifyCommand, async () => {
            const activeTextEditor = vscode.window.activeTextEditor;
            if (activeTextEditor !== undefined) {
                await activeTextEditor.document.save().then(
                    () => runVerification(activeTextEditor.document)
                );
            } else {
                util.log("vscode.window.activeTextEditor is not ready yet.");
            }
        })
    );

    // Verify on click
    const verifyButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10);
    verifyButton.command = verifyCommand;
    verifyButton.text = "$(play) Verify with Prusti";
    verifyButton.tooltip = "Run the Prusti verifier on this file.";
    verifyButton.show();
    context.subscriptions.push(verifyButton);

    // Verify on save
    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument(async (document: vscode.TextDocument) => {
            if (config.verifyOnSave()) {
                await runVerification(document);
            }
        })
    );

    // Verify on open
    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument(async (document: vscode.TextDocument) => {
            if (config.verifyOnOpen()) {
                await runVerification(document);
            }
        })
    );

    if (config.verifyOnOpen()) {
        // Verify active document
        if (vscode.window.activeTextEditor !== undefined) {
            await runVerification(
                vscode.window.activeTextEditor.document
            );
        } else {
            util.log("vscode.window.activeTextEditor is not ready yet.");
        }
    }

    state.notifyExtensionActivation();
}
