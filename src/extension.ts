'use strict';

import * as vscode from 'vscode';
import * as config from './config';
import * as util from './util';
import * as diagnostics from './diagnostics';
import * as prerequisites from './prerequisites';

export async function activate(context: vscode.ExtensionContext) {
    util.log('Start Prusti Assistant');

    // Prerequisites checks
    if (!await prerequisites.hasPrerequisites()) {
        util.log("Prusti Assistant's prerequisites are not satisfied.");
        util.log("Stopping plugin. Restart the IDE to retry.");
        return;
    }

    // Shared collection of diagnostics
    const diagnosticCollection = vscode.languages.createDiagnosticCollection("prusti");

    // Define verification function
    async function runVerification() {
        const projects = await util.findProjects();

        if (!projects.hasProjects()) {
            vscode.window.showWarningMessage('Prusti Assistant: No `Cargo.toml` files were found in the workspace.');
        }

        const diagnosticManager = new diagnostics.DiagnosticsManager(
            projects,
            diagnosticCollection
        );

        diagnosticManager.run();
    }

    // Verify on command
    context.subscriptions.push(
        vscode.commands.registerCommand('prusti-assistant.verify', async () => {
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
            if (document.languageId === 'rust') {
                // Verify on save
                if (config.verifyOnSave()) {
                    await runVerification();
                }
            }
        })
    );
}
