import * as vscode from 'vscode';
import { performance } from 'perf_hooks';
import * as config from './config';
import * as util from './util';
import * as diagnostics from './diagnostics';
import * as checks from './checks';
import * as notifier from './notifier';
import * as deps from './dependencies';

export async function activate(context: vscode.ExtensionContext) {
    notifier.notify(notifier.Event.StartExtensionActivation);
    util.log("Start Prusti Assistant");

    // Download dependencies
    util.log("Checking dependencies...");
    let prusti = await deps.installDependencies(context, false);

    // Update dependencies on command
    context.subscriptions.push(
        vscode.commands.registerCommand("prusti-assistant.update", async () => {
            prusti = await deps.installDependencies(context, true);
        })
    );

    // Prerequisites checks
    util.log("Checking prerequisites...");
    const [hasPrerequisites, errorMessage] = await checks.hasPrerequisites(prusti, context);
    if (!hasPrerequisites) {
        util.userError("Prusti Assistant's prerequisites are not satisfied.", false);
        util.userError(errorMessage, true, true);
        util.log("Stopping plugin. Restart the IDE to retry.");
        return;
    } else {
        util.log("Prerequisites are satisfied.");
    }

    await deps.ensureRustToolchainInstalled(context, await prusti.rustToolchainVersion());

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
                vscode.window.setStatusBarMessage("$(loading~spin) Running Prusti...");
                const start = performance.now();

                const programDiagnostics = await diagnostics.generatesProgramDiagnostics(
                    prusti,
                    document.uri.fsPath
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

            const crateDiagnostics = await diagnostics.generatesCratesDiagnostics(prusti, projects);
            crateDiagnostics.render(prustiCratesDiagnostics);

            const duration = Math.round((performance.now() - start) / 100) / 10;
            if (crateDiagnostics.hasErrors()) {
                vscode.window.setStatusBarMessage(`Verification of some crate failed (${duration} s)`);
            } else if (crateDiagnostics.hasWarnings()) {
                vscode.window.setStatusBarMessage(`Verification of all crates succeeded with warnings (${duration} s)`);
            } else {
                vscode.window.setStatusBarMessage(`Verification of all crates succeeded (${duration} s)`);
            }
        }
        notifier.notify(notifier.Event.EndVerification);
    }

    const verifyCommand = "prusti-assistant.verify";
    // Verify on command
    context.subscriptions.push(
        vscode.commands.registerCommand(verifyCommand, async () => {
            if (vscode.window.activeTextEditor !== undefined) {
                vscode.window.activeTextEditor.document.save();
                await runVerification(
                    vscode.window.activeTextEditor.document
                );
            } else {
                util.log("vscode.window.activeTextEditor is not ready yet.");
            }
        })
    );

    const verifyButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10);
    verifyButton.command = verifyCommand;
    verifyButton.text = "$(play) Verify";
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

    notifier.notify(notifier.Event.EndExtensionActivation);
}
