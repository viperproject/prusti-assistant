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
    const verifyProgramCommand = "prusti-assistant.verify";
    const killAllCommand = "prusti-assistant.killAll";

    // Verification status
    const verificationStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10);
    verificationStatus.text = "";
    verificationStatus.tooltip = "$(loading~spin) Activating Prusti...";
    verificationStatus.show();
    context.subscriptions.push(verificationStatus);

    // Prerequisites checks
    util.log("Checking Prusti prerequisites...");
    verificationStatus.tooltip = "$(loading~spin) Checking Prusti prerequisites...";
    const [hasPrerequisites, errorMessage] = await checks.hasPrerequisites();
    if (!hasPrerequisites) {
        verificationStatus.tooltip = "Prusti Assistant's prerequisites are not satisfied.";
        util.userError(errorMessage, true);
        util.log("Stopping plugin. Reload the IDE to retry.");
        return;
    } else {
        util.log("Prerequisites are satisfied.");
    }

    // Download dependencies and start the server
    util.log("Check the Prusti dependencies...");
    verificationStatus.tooltip = "$(loading~spin) Checking Prusti dependencies...";
    await installDependencies(context, false, verificationStatus);

    // Check Prusti
    util.log("Checking Prusti dependencies...");
    const [isPrustiOk, prustiErrorMessage] = await checks.checkPrusti(prusti!);
    if (!isPrustiOk) {
        util.userError(prustiErrorMessage, true, verificationStatus);
        util.log("Stopping plugin. Reload the IDE to retry.");
        return;
    } else {
        util.log("Prusti checks completed.");
    }

    // Verify on click
    const verifyProgramButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 12);
    verifyProgramButton.command = verifyProgramCommand;
    verifyProgramButton.text = "$(play) Verify with Prusti";
    verifyProgramButton.tooltip = "Run the Prusti verifier on this file.";
    verifyProgramButton.show();
    context.subscriptions.push(verifyProgramButton);

    // Kill-all on click
    const killAllButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 11);
    killAllButton.command = killAllCommand;
    killAllButton.text = "$(close) Stop Prusti";
    killAllButton.tooltip = "Kill all Prusti processes.";
    killAllButton.command = killAllCommand;
    context.subscriptions.push(killAllButton);

    // Prepare the server
    server.registerCrashHandler(context, verificationStatus);

    // Update dependencies on command
    context.subscriptions.push(
        vscode.commands.registerCommand("prusti-assistant.update", async () => {
            await installDependencies(context, true, verificationStatus);
        })
    );

    // Restart the server on command
    context.subscriptions.push(
        vscode.commands.registerCommand("prusti-assistant.restart-server", async () => {
            await server.restart(context, verificationStatus);
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
                await installDependencies(context, false, verificationStatus);
            }
            const hasChangedServer = event.affectsConfiguration(config.serverAddressPath);
            if (hasChangedServer) {
                util.log("Restart the server because the configuration changed...");
                await server.restart(context, verificationStatus);
            }
            // Let the test suite know that the new configuration has been
            // processed
            state.notifyConfigUpdate();
        })
    );

    // Diagnostics manager
    const verificationDiagnostics = vscode.languages.createDiagnosticCollection("prusti");
    context.subscriptions.push(verificationDiagnostics);
    const verificationManager = new diagnostics.DiagnosticsManager(
        verificationDiagnostics,
        verificationStatus,
        killAllButton
    );
    context.subscriptions.push(verificationManager);

    // Kill-all on command
    context.subscriptions.push(
        vscode.commands.registerCommand(killAllCommand, () => verificationManager.killAll())
    );

    // Define verification function
    async function verify(document: vscode.TextDocument) {
        util.log(`Run verification on ${document}...`);

        if (server.address === undefined) {
            // Just warn, as Prusti can run even without a server.
            util.userWarn(
                "Prusti might run slower than usual because the Prusti server is not running."
            );
        }

        if (config.verificationMode() === config.VerificationMode.CurrentProgram) {
            // Verify provided document
            if (document.languageId !== "rust") {
                util.userWarn(
                    `The active document is not a Rust program (it's ${document.languageId}), thus Prusti will not try to verify it.`
                );
                return;
            }

            await verificationManager.verify(
                prusti!,
                server.address || "",
                document.uri.fsPath,
                diagnostics.VerificationTarget.StandaloneFile
            );
        } else {
            const projects = await util.findProjects();
            if (projects.isEmpty()) {
                util.userWarn(
                    "Prusti Assistant: No 'Cargo.toml' files were found in the workspace."
                );
                return;
            }

            const cratePath = projects.getParent(document.uri.fsPath);
            if (cratePath === undefined) {
                util.userWarn(
                    "Prusti Assistant: No 'Cargo.toml' file has been found in the outer folders of the current file."
                );
                return;
            }

            await verificationManager.verify(
                prusti!,
                server.address || "",
                cratePath.path,
                diagnostics.VerificationTarget.Crate
            );
        }
    }

    // Verify on command
    context.subscriptions.push(
        vscode.commands.registerCommand(verifyProgramCommand, async () => {
            const activeTextEditor = vscode.window.activeTextEditor;
            if (activeTextEditor !== undefined) {
                await activeTextEditor.document.save().then(
                    () => verify(activeTextEditor.document)
                );
            } else {
                util.log("vscode.window.activeTextEditor is not ready yet.");
            }
        })
    );

    // Verify on save
    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument(async (document: vscode.TextDocument) => {
            if (document.languageId === "rust" && config.verifyOnSave()) {
                await verify(document);
            }
        })
    );

    // Verify on open
    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument(async (document: vscode.TextDocument) => {
            if (document.languageId === "rust" && config.verifyOnOpen()) {
                await verify(document);
            }
        })
    );

    if (config.verifyOnOpen()) {
        // Verify on activation
        if (vscode.window.activeTextEditor !== undefined) {
            await verify(
                vscode.window.activeTextEditor.document
            );
        } else {
            util.log("vscode.window.activeTextEditor is not ready yet.");
        }
    }

    // Stand ready to deactivate the extension
    context.subscriptions.push({
        dispose: () => {
            console.log("Dispose Prusti Assistant");
            deactivate().catch(
                err => console.error(`Failed to deactivate the extension: ${err}`)
            );
        }
    });
    process.on("SIGTERM", () => {
        console.log("Received SIGTERM");
        deactivate().catch(
            err => console.error(`Failed to deactivate the extension: ${err}`)
        );
    });

    state.notifyExtensionActivation();
}

export async function deactivate(): Promise<void> {
    console.log("Deactivate Prusti Assistant");
    await server.stop();
}
