import * as vscode from "vscode";
import * as config from "./config";
import * as util from "./util";
import * as diagnostics from "./diagnostics";
import * as checks from "./checks";
import { prusti, installDependencies, prustiVersion } from "./dependencies";
import * as server from "./server";
import * as state from "./state";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    util.log("Activate Prusti Assistant");
    const showVersionCommand = "prusti-assistant.show-version";
    const verifyProgramCommand = "prusti-assistant.verify";
    const killAllCommand = "prusti-assistant.killAll";
    const openLogsCommand = "prusti-assistant.openLogs";
    const openServerLogsCommand = "prusti-assistant.openServerLogs";
    const updateCommand = "prusti-assistant.update";
    const restartServerCommand = "prusti-assistant.restart-server";
    const clearDiagnosticsCommand = "prusti-assistant.clear-diagnostics";

    // Open logs on command
    context.subscriptions.push(
        vscode.commands.registerCommand(openLogsCommand, () => util.showLogs())
    );
    context.subscriptions.push(
        vscode.commands.registerCommand(openServerLogsCommand, () => server.showLogs())
    );

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
            util.log("The Prusti version is outdated.");
            util.userInfoPopup(
                "Your version of Prusti is outdated.",
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

    // Verify on click
    const prustiButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 11);
    prustiButton.command = verifyProgramCommand;
    prustiButton.text = "$(play) Prusti";
    prustiButton.tooltip = new vscode.MarkdownString(
        "Run the [Prusti verifier](https://github.com/viperproject/prusti-dev) on the current file.\n\n" +
        "---\n\n" +
        "$(link) [User guide](https://viperproject.github.io/prusti-dev/user-guide/)\n\n" +
        "$(link) [Zulip chat](https://prusti.zulipchat.com/)\n\n" +
        `[Show version](command:${showVersionCommand})\n\n` +
        `[Update Prusti](command:${updateCommand})\n\n` +
        `[Restart server](command:${restartServerCommand})\n\n` +
        `[Clear diagnostics](command:${clearDiagnosticsCommand})`,
        true,
    );
    prustiButton.tooltip.isTrusted = true;
    prustiButton.show();
    context.subscriptions.push(prustiButton);

    // Restart the server on command
    context.subscriptions.push(
        vscode.commands.registerCommand(restartServerCommand, async () => {
            await server.restart(context, verificationStatus);
        })
    );

    // Update dependencies on config change
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(async event => {
            const hasChangedVersion = event.affectsConfiguration(config.prustiVersionPath);
            const hasChangedLocation = (
                config.prustiVersion() === config.PrustiVersion.Local
                && event.affectsConfiguration(config.localPrustiPathPath)
            );
            const hasChangedTag = (
                config.prustiVersion() === config.PrustiVersion.Tag
                && event.affectsConfiguration(config.prustiTagPath)
            );
            if (hasChangedVersion || hasChangedLocation || hasChangedTag) {
                util.log("Install the dependencies because the configuration has changed...");
                const reDownload = config.prustiVersion() === config.PrustiVersion.Tag;
                await installDependencies(context, reDownload, verificationStatus);
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
    );
    context.subscriptions.push(verificationManager);

    // Clear all diagnostics on command
    context.subscriptions.push(
        vscode.commands.registerCommand(clearDiagnosticsCommand, () => verificationManager.clearDiagnostics())
    );

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
                server.address ?? "",
                document.uri.fsPath,
                diagnostics.VerificationTarget.StandaloneFile
            );
        } else {
            await verificationManager.verify(
                prusti!,
                server.address ?? "",
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
