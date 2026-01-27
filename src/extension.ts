import * as vscode from "vscode";
import * as config from "./config";
import * as util from "./util";
import * as checks from "./checks";
import * as path from "path";
import { prusti, installDependencies, updatePrustiSemVersion, prustiSemanticVersion } from "./dependencies";
import * as server from "./server";
import * as state from "./state";
import * as verification from "./verification";
import { projects } from "./projects";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    util.log("Activate Prusti Assistant");
    const showVersionCommand = "prusti-assistant.show-version";
    const verifyProgramCommand = "prusti-assistant.verify";
    const verifySelectiveCommand = "prusti-assistant.verify-selective";
    const queryMethodSignatureCommand = "prusti-assistant.query-method-signature";
    const getInfoCommand = "prusti-assistant.getinfo";
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

    // Download dependencies, set prusti version and start the server
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
            // take also the semantic version here to avoid confusion on debugging
            await updatePrustiSemVersion();
            util.userInfo(prustiSemanticVersion);
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

    // Kill all button
    const killAllButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 9);
    killAllButton.command = killAllCommand;
    killAllButton.text = "$(x) Kill All";
    killAllButton.tooltip = "Kill all running Prusti processes";
    context.subscriptions.push(killAllButton);

    // Restart the server on command
    context.subscriptions.push(
        vscode.commands.registerCommand(restartServerCommand, async () => {
            await server.restart(context, verificationStatus);
        })
    );

    // Verification manager
    const verificationManager = new verification.VerificationManager(
        verificationStatus,
        killAllButton,
    );
    context.subscriptions.push(verificationManager);

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
            // update version
            await updatePrustiSemVersion();

            // Let the test suite know that the new configuration has been
            // processed
            state.notifyConfigUpdate();
        })
    );


    // Clear all diagnostics on command
    context.subscriptions.push(
        vscode.commands.registerCommand(clearDiagnosticsCommand, () => verificationManager.clearDiagnostics())
    );

    // Kill-all on command
    context.subscriptions.push(
        vscode.commands.registerCommand(killAllCommand, () => verificationManager.killAll())
    );

    // Define verification function
    async function verify(
        document: vscode.TextDocument,
        skipVerify: boolean,
        defPathArg: {
            selectiveVerification?: string,
            externalSpecRequest?: string,
        },
        isOnOpen = false,
    ) {
        util.log(`Run verification on ${document.uri.fsPath}...`);
        await projects.update();
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
                new verification.VerificationArgs(
                    prusti!,
                    server.address || "",
                    document.uri.fsPath,
                    verification.VerificationTarget.StandaloneFile,
                    skipVerify,
                    defPathArg,
                    isOnOpen,
                    0,
                )
            );
        } else {
            await verificationManager.verify(
                new verification.VerificationArgs(
                    prusti!,
                    server.address || "",
                    cratePath.path,
                    verification.VerificationTarget.Crate,
                    skipVerify,
                    defPathArg,
                    isOnOpen,
                    0,
                )
            );
        }
    }

    // Verify on command
    context.subscriptions.push(
        vscode.commands.registerCommand(verifyProgramCommand, async () => {
            const activeTextEditor = vscode.window.activeTextEditor;
            if (activeTextEditor !== undefined) {
                await activeTextEditor.document.save().then(
                    () => verify(activeTextEditor.document, false, {})
                );
            } else {
                util.log("vscode.window.activeTextEditor is not ready yet.");
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(verifySelectiveCommand, async (names: string[]) => {
            const activeTextEditor = vscode.window.activeTextEditor;
            util.log("Verify selective received arg: " + names.join(", "));
            const defPathArg = {
                selectiveVerification: names.join(" "),
            }
            if (activeTextEditor !== undefined) {
                await activeTextEditor.document.save().then(
                    () => verify(activeTextEditor.document, false, defPathArg)
                );
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(queryMethodSignatureCommand, async (name: string) => {
            const activeTextEditor = vscode.window.activeTextEditor;
            const defPathArg = {
                externalSpecRequest: name,
            }
            if (activeTextEditor !== undefined) {
                await activeTextEditor.document.save().then(
                    () => verify(activeTextEditor.document, true, defPathArg)
                );
            }
        })
    );


    context.subscriptions.push(
        vscode.commands.registerCommand(getInfoCommand, async () => {
            const activeTextEditor = vscode.window.activeTextEditor;
            if (activeTextEditor !== undefined) {
                await activeTextEditor.document.save().then(
                    () => verify(activeTextEditor.document, true, {})
                );
            } else {
                util.log("vscode.window.activeTextEditor is not ready yet.");
            }
        })
    );

    // Verify on save
    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument(async (document: vscode.TextDocument) => {
            const is_prusti_toml = path.basename(document.fileName) === "Prusti.toml";
            if ((is_prusti_toml || document.languageId === "rust") && config.verifyOnSave()) {
                await verify(document, false, {});
            } else {
                await verify(document, true, {});
            }
        })
    );

    // Verify on open
    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument(async (document: vscode.TextDocument) => {
            if (document.languageId === "rust") {
                // the only two cases where we pass the onOpen boolean as true
                if (config.verifyOnOpen()) {
                    await verify(document, false, {}, true);
                } else {
                    if (!verificationManager.wasVerifiedBefore(document.uri.fsPath)) {
                        util.log("Running analysis on a file on open");
                        await verify(document, true, {}, true);
                    }
                }
            }
        })
    );

    // Verify on activation, if verifyOnOpen is set, otherwise still call prusti
    // but just collect IDE info.
    if (vscode.window.activeTextEditor !== undefined) {
        if (vscode.window.activeTextEditor.document.languageId === "rust") {
            await verify(
                vscode.window.activeTextEditor.document,
                !config.verifyOnOpen(),
                {}
            );
        }
    } else {
        util.log("vscode.window.activeTextEditor is not ready yet.");
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
