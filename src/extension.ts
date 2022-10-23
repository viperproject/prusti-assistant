import * as vscode from "vscode";
import * as config from "./config";
import * as util from "./util";
import * as diagnostics from "./diagnostics";
import * as checks from "./checks";
import { prusti, installDependencies, prustiVersion, spanInfo } from "./dependencies";
import * as server from "./server";
import * as state from "./state";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    util.userInfoPopup("Trying to activate prusti assistant...", "no action to be taken", ()=>{});
    util.log("Activate Prusti Assistant");
    const showVersionCommand = "prusti-assistant.show-version";
    const verifyProgramCommand = "prusti-assistant.verify";
    const killAllCommand = "prusti-assistant.killAll";
    const updateCommand = "prusti-assistant.update";
    
    // new command for prototype:
    const spanInfoCommand = "prusti-assistant.span-info";

    // Verification status
    const verificationStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10);
    verificationStatus.tooltip = "Status of the Prusti verification.";
    verificationStatus.text = "$(sync~spin) Activating Prusti...";
    verificationStatus.show();
    context.subscriptions.push(verificationStatus);

    // Prerequisites checks
    util.log("Checking Prusti prerequisites...");
    verificationStatus.text = "$(sync~spin) Checking Prusti prerequisites...";
    const [hasPrerequisites, errorMessage] = await checks.hasPrerequisites();
    if (!hasPrerequisites) {
        verificationStatus.tooltip = "Prusti Assistant's prerequisites are not satisfied.";
        util.userError(errorMessage);
        util.log("Stopping plugin. Reload the IDE to retry.");
        return;
    } else {
        util.log("Prerequisites are satisfied.");
    }

    // Catch server crashes
    server.registerCrashHandler(context, verificationStatus);

    // Download dependencies and start the server
    util.log("Checking Prusti dependencies...");
    verificationStatus.text = "$(sync~spin) Checking Prusti dependencies...";
    await installDependencies(context, false, verificationStatus);

    // Check Prusti
    util.log("Checking Prusti...");
    const [isPrustiOk, prustiErrorMessage] = await checks.checkPrusti(prusti!);
    if (!isPrustiOk) {
        verificationStatus.tooltip = "Prusti's installation seems broken.";
        util.userError(prustiErrorMessage, true, verificationStatus);
        util.log("Stopping plugin. Reload the IDE to retry.");
        return;
    } else {
        util.log("Prusti checks completed.");
    }

    // Update dependencies on command
    context.subscriptions.push(
        vscode.commands.registerCommand(updateCommand, async () => {
            await installDependencies(context, true, verificationStatus);
        })
    );

    // Check for updates
    if (config.checkForUpdates()) {
        util.log("Checking for updates...");
        if (await checks.isOutdated(prusti!)) {
            util.log("Prusti is outdated.");
            util.userInfoPopup(
                "The Prusti verifier is outdated.",
                "Download Update",
                () => {
                    vscode.commands.executeCommand(updateCommand)
                        .then(undefined, err => util.log(`Error: ${err}`));
                }
            );
        } else {
            util.log("Prusti is up-to-date.");
        }
    }

    // Show version on command
    context.subscriptions.push(
        vscode.commands.registerCommand(showVersionCommand, async () => {
            util.userInfo(await prustiVersion());
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(spanInfoCommand, async () => {
            util.userInfo(await spanInfo());
        })
    );

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
                util.log("Install the dependencies because the configuration has changed...");
                await installDependencies(context, false, verificationStatus);
            }
            const hasChangedServer = event.affectsConfiguration(config.serverAddressPath);
            if (hasChangedServer) {
                util.log("Restart the server because the configuration has changed...");
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
        util.log(`Run verification on ${document.uri.fsPath}...`);
        const projects = await util.findProjects();
        const cratePath = projects.getParent(document.uri.fsPath);

        if (server.address === undefined) {
            // Just warn, as Prusti can run even without a server.
            util.userWarn(
                "Prusti might run slower than usual because the Prusti server is not running."
            );
        }

        if (cratePath === undefined) {
            if (document.languageId !== "rust") {
                util.userWarn(
                    `The active document is not a Rust program (it is ${document.languageId}) and it is not part of a crate.`
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
            util.log("Dispose Prusti Assistant");
            deactivate().catch(
                err => util.log(`Failed to deactivate the extension: ${err}`)
            );
        }
    });
    process.on("SIGTERM", () => {
        util.log("Received SIGTERM");
        deactivate().catch(
            err => util.log(`Failed to deactivate the extension: ${err}`)
        );
    });

    state.notifyExtensionActivation();
}

export async function deactivate(): Promise<void> {
    util.log("Deactivate Prusti Assistant");
    await server.stop();
}
