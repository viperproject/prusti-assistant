'use strict';

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as fs_extra from 'fs-extra';
import * as path from 'path';
import { performance } from 'perf_hooks';
import * as config from './config';
import * as util from './util';
import * as diagnostics from './diagnostics';
import * as checks from './checks';
import * as notifier from './notifier';

export async function activate(context: vscode.ExtensionContext) {
    notifier.notify(notifier.Event.StartExtensionActivation);
    util.log("Start Prusti Assistant");

    // Define update dependencies function
    async function updateDependencies(update: boolean) {
        // Download
        notifier.notify(notifier.Event.StartPrustiUpdate);
        util.userInfo("Downloading Prusti...");
        const prustiToolsUrl = config.prustiToolsUrl();
        if (prustiToolsUrl === null) {
            util.userError(`Error downloading Prusti: OS detection failed.`);
            notifier.notify(notifier.Event.EndPrustiUpdate);
            return;
        }
        const prustiToolsZip = config.prustiToolsZip(context);
        fs_extra.ensureDirSync(path.dirname(prustiToolsZip));
        const [downloadSuccessful, downloadError] = await util.download(
            prustiToolsUrl,
            prustiToolsZip
        );
        if (!downloadSuccessful) {
            util.userError(`Error downloading Prusti: ${downloadError}`);
            notifier.notify(notifier.Event.EndPrustiUpdate);
            return;
        }

        // Extract
        util.userInfo("Extracting Prusti...", false);
        fs_extra.emptyDirSync(config.prustiHome(context));
        const [extractSuccessful, extractError] = await util.extract(
            prustiToolsZip,
            config.prustiHome(context)
        );
        if (!extractSuccessful) {
            util.userError(`Error extracting Prusti: ${extractError}`);
            notifier.notify(notifier.Event.EndPrustiUpdate);
            return;
        }

        // Set execution flags (ignored on Windows)
        fs.chmodSync(config.prustiDriverExe(context), "775");
        fs.chmodSync(config.prustiRustcExe(context), "775");
        fs.chmodSync(config.cargoPrustiExe(context), "775");
        fs.chmodSync(config.z3Exe(context), "775");

        if (update) {
            util.userInfo("Prusti updated succesfully. Please restart the IDE.", true, true);
        } else {
            util.userInfo("Prusti downloaded succesfully.");
        }
        notifier.notify(notifier.Event.EndPrustiUpdate);
    }

    // Update dependencies on command
    context.subscriptions.push(
        vscode.commands.registerCommand("prusti-assistant.update", async () => {
            await updateDependencies(true);
        })
    );

    // Download dependencies
    const hasDependencies = await checks.hasDependencies(context);
    if (!hasDependencies) {
        util.log("Dependencies are missing.");
        await updateDependencies(false);
    }

    // Prerequisites checks
    const [hasPrerequisites, errorMessage] = await checks.hasPrerequisites(context);
    if (!hasPrerequisites) {
        util.userError("Prusti Assistant's prerequisites are not satisfied.", false);
        util.userError(errorMessage, true, true);
        util.log("Stopping plugin. Restart the IDE to retry.");
        return;
    }

    // Shared collection of diagnostics
    const prustiProgramDiagnostics = vscode.languages.createDiagnosticCollection("prusti-program");
    const prustiCratesDiagnostics = vscode.languages.createDiagnosticCollection("prusti-crates");

    // Define verification function
    async function runVerification(document: vscode.TextDocument) {
        notifier.notify(notifier.Event.StartVerification);
        util.log("Run verification...");

        // Verify provided document
        if (config.verificationMode() === config.VerificationMode.CurrentProgram) {
            if (document.languageId === "rust") {
                vscode.window.setStatusBarMessage("Running Prusti...");
                const start = performance.now();

                const programDiagnostics = await diagnostics.generatesProgramDiagnostics(
                    context,
                    document.uri.fsPath
                );
                programDiagnostics.render(prustiProgramDiagnostics);

                const duration = Math.round((performance.now() - start) / 100) / 10;
                if (programDiagnostics.hasErros()) {
                    vscode.window.setStatusBarMessage(`Verification failed (${duration} s)`);
                } else if (programDiagnostics.hasWarnings()) {
                    vscode.window.setStatusBarMessage(`Verification succeeded with warnings (${duration} s)`);
                } else {
                    vscode.window.setStatusBarMessage(`Verification succeeded (${duration} s)`);
                }
            } else {
                util.log(
                    "The document is not a Rust program, thus Prusti will not run on it."
                );
            }
        }

        // Verify all crates in workspace
        if (config.verificationMode() === config.VerificationMode.AllCratesInWorkspace) {
            vscode.window.setStatusBarMessage("Running Prusti...");
            const start = performance.now();

            const projects = await util.findProjects();
            if (!projects.hasProjects()) {
                vscode.window.showWarningMessage(
                    "Prusti Assistant: No 'Cargo.toml' files were found in the workspace."
                );
            }

            const crateDiagnostics = await diagnostics.generatesCratesDiagnostics(context, projects);
            crateDiagnostics.render(prustiCratesDiagnostics);

            const duration = Math.round((performance.now() - start) / 100) / 10;
            if (crateDiagnostics.hasErros()) {
                vscode.window.setStatusBarMessage(`Verification of some crate failed (${duration} s)`);
            } else if (crateDiagnostics.hasWarnings()) {
                vscode.window.setStatusBarMessage(`Verification of all crates succeeded with warnings (${duration} s)`);
            } else {
                vscode.window.setStatusBarMessage(`Verification of all crates succeeded (${duration} s)`);
            }
        }
        notifier.notify(notifier.Event.EndVerification);
    }

    // Verify on command
    context.subscriptions.push(
        vscode.commands.registerCommand("prusti-assistant.verify", async () => {
            if (vscode.window.activeTextEditor) {
                vscode.window.activeTextEditor.document.save();
                await runVerification(
                    vscode.window.activeTextEditor.document
                );
            } else {
                util.log("vscode.window.activeTextEditor is not ready yet.");
            }
        })
    );

    // Verify on save
    if (config.verifyOnSave()) {
        context.subscriptions.push(
            vscode.workspace.onDidSaveTextDocument(async (document: vscode.TextDocument) => {
                await runVerification(document);
            })
        );
    }

    // Verify on open
    if (config.verifyOnOpen()) {
        context.subscriptions.push(
            vscode.workspace.onDidOpenTextDocument(async (document: vscode.TextDocument) => {
                await runVerification(document);
            })
        );

        // Verify active document
        if (vscode.window.activeTextEditor) {
            await runVerification(
                vscode.window.activeTextEditor.document
            );
        } else {
            util.log("vscode.window.activeTextEditor is not ready yet.");
        }
    }

    notifier.notify(notifier.Event.EndExtensionActivation);
}
