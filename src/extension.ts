import * as vscode from "vscode";
import { performance } from "perf_hooks";
import * as config from "./config";
import * as util from "./util";
import * as diagnostics from "./diagnostics";
import * as checks from "./checks";
import { prusti, installDependencies } from "./dependencies";
import * as server from "./server";
import * as state from "./state";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    util.log("Activate Prusti Assistant");

    // Prerequisites checks
    util.log("Checking Prusti prerequisites...");
    const [hasPrerequisites, errorMessage] = await checks.hasPrerequisites();
    if (!hasPrerequisites) {
        util.userError("Prusti Assistant's prerequisites are not satisfied.", false);
        util.userError(errorMessage, true, true);
        util.log("Stopping plugin. Reload the IDE to retry.");
        return;
    } else {
        util.log("Prerequisites are satisfied.");
    }

    // Download dependencies and start the server
    util.log("Check the Prusti dependencies...");
    await installDependencies(context, false);

    // Check Prusti
    util.log("Checking Prusti dependencies...");
    const [isPrustiOk, prustiErrorMessage] = await checks.checkPrusti(prusti!);
    if (!isPrustiOk) {
        util.userError(prustiErrorMessage, true, true);
        util.log("Stopping plugin. Reload the IDE to retry.");
        return;
    } else {
        util.log("Prusti checks completed.");
    }

    // Prepare the server
    server.registerCrashHandler(context);

    // Update dependencies on command
    context.subscriptions.push(
        vscode.commands.registerCommand("prusti-assistant.update", async () => {
            await installDependencies(context, true);
        })
    );

    // Restart the server on command
    context.subscriptions.push(
        vscode.commands.registerCommand("prusti-assistant.restart-server", async () => {
            await server.restart(context);
        })
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
                await server.restart(context);
            }
            // Let the test suite know that the new configuration has been
            // processed
            state.notifyConfigUpdate();
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
                    util.userWarn(
                        `The active document is not a Rust program (it's ${document.languageId}), thus Prusti will not try to verify it.`
                    );
                    break;
                }

                if (server.address === undefined) {
                    // Just warn, as Prusti can run even without a server.
                    util.userWarn(
                        "Prusti might run slower than usual because the Prusti server is not running."
                    );
                }

                vscode.window.setStatusBarMessage("$(loading~spin) Running Prusti...");
                const start = performance.now();

                const programDiagnostics = await diagnostics.generatesProgramDiagnostics(
                    prusti!,
                    document.uri.fsPath,
                    server.address
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
                    vscode.window.showWarningMessage(
                        "Prusti Assistant: No 'Cargo.toml' files were found in the workspace."
                    ).then(undefined, err => {
                        util.log(`Error: ${err}`);
                    });
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

    // Stand ready to deactivate the extension
    context.subscriptions.push({
        dispose: async () => {
            console.log("Dispose Prusti Assistant");
            await deactivate();
        }
    });
    process.on("SIGTERM", () => {
        console.log("Received SIGTERM");
        deactivate().catch(
            err => console.error(`Failed to deactivate the extension: ${err}`)
        )
    });

    state.notifyExtensionActivation();
}

export async function deactivate(): Promise<void> {
    console.log("Deactivate Prusti Assistant");
    await server.stop();
}
