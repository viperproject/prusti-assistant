'use strict';

import * as vscode from 'vscode';
import { performance } from 'perf_hooks';
import * as config from './config';
import * as util from './util';
import * as diagnostics from './diagnostics';
import * as prerequisites from './prerequisites';

export async function activate(context: vscode.ExtensionContext) {
    util.log("Start Prusti Assistant");

    // Prerequisites checks
    let [hasPrerequisites, errorMessage] = await prerequisites.hasPrerequisites();
    if (!hasPrerequisites) {
        util.log("Prusti Assistant's prerequisites are not satisfied.");
        util.log(errorMessage);
        util.log("Stopping plugin. Restart the IDE to retry.");
        vscode.window.showErrorMessage(errorMessage);
        vscode.window.setStatusBarMessage(errorMessage);
        return;
    }

    // Shared collection of diagnostics
    const prustiProgramDiagnostics = vscode.languages.createDiagnosticCollection("prusti-program");
    const prustiCratesDiagnostics = vscode.languages.createDiagnosticCollection("prusti-crates");

    // Define verification function
    async function runVerification() {

        // Verify current program
        if (config.verificationMode() === config.VerificationMode.CurrentProgram) {
            if (vscode.window.activeTextEditor) {
                let currentDocument = vscode.window.activeTextEditor.document;
                if (currentDocument.languageId === "rust") {
                    vscode.window.setStatusBarMessage("Running Prusti...");
                    const start = performance.now();

                    const programDiagnostics = await diagnostics.generatesProgramDiagnostics(
                        currentDocument.uri.fsPath
                    );
                    programDiagnostics.render(prustiProgramDiagnostics);

                    const duration = Math.round((performance.now() - start) / 100) / 10;
                    if (programDiagnostics.isEmpty()) {
                        vscode.window.setStatusBarMessage(`Verification succeeded (${duration} s)`);
                    } else {
                        vscode.window.setStatusBarMessage(`Verification failed (${duration} s)`);
                    }
                } else {
                    util.log(
                        "The current tab is not a Rust program, thus Prusti will not run on it."
                    );
                }
            } else {
                util.log("Error: No active text editor");
            }
        }

        // Verify all crates in workspace
        if (config.verificationMode() === config.VerificationMode.AllCratesInWorkspace) {
            vscode.window.setStatusBarMessage("Running Prusti...");
            const start = performance.now();

            const projects = await util.findProjects();
            if (!projects.hasProjects()) {
                vscode.window.showWarningMessage(
                    "Prusti Assistant: No `Cargo.toml` files were found in the workspace."
                );
            }

            const crateDiagnostics = await diagnostics.generatesCratesDiagnostics(projects);
            crateDiagnostics.render(prustiCratesDiagnostics);

            const duration = Math.round((performance.now() - start) / 100) / 10;
            if (crateDiagnostics.isEmpty()) {
                vscode.window.setStatusBarMessage(`Verification of all crates succeeded (${duration} s)`);
            } else {
                vscode.window.setStatusBarMessage(`Verification of some crate failed (${duration} s)`);
            }
        }
    }

    // Verify on command
    context.subscriptions.push(
        vscode.commands.registerCommand("prusti-assistant.verify", async () => {
            await runVerification();
        })
    );

    // Verify on startup
    if (config.verifyOnStartup()) {
        await runVerification();
    }
    
    // On save logic
    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument(async (document: vscode.TextDocument) => {
            if (document.languageId === "rust") {
                // Verify on save
                if (config.verifyOnSave()) {
                    await runVerification();
                }
            }
        })
    );
}
