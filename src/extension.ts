'use strict';

import * as vscode from 'vscode';
import * as config from './config';
import * as util from './util';
import * as diagnostics from './diagnostics';
import * as format from './format';

export async function activate(context: vscode.ExtensionContext) {
    const projects = await util.findProjects();

    if (!projects.hasProjects()) {
        vscode.window.showWarningMessage('Rust Assist: No `Cargo.toml` files were found in the workspace, unable to start plugin.');
        return;
    }

    // ====================================================
    // Diagnostics
    // ====================================================

    diagnostics.hasPrerequisites().then(result => {
        if (result) {
            const rustDiagnostics = vscode.languages.createDiagnosticCollection("rust");
            const diagnosticManager = new diagnostics.DiagnosticsManager(projects, rustDiagnostics);

            context.subscriptions.push(
                vscode.commands.registerCommand('rust-assist.refreshDiagnostics', async () => {
                    diagnosticManager.refreshAll();
                })
            );

            if (config.diagnosticsOnSave()) {
                context.subscriptions.push(
                    vscode.workspace.onDidSaveTextDocument(async (document: vscode.TextDocument) => {
                        if (document.languageId === 'rust') {
                            diagnosticManager.refreshAll();
                        }
                    })
                );
            }

            if (config.diagnosticsOnStartup()) {
                diagnosticManager.refreshAll();
            }
        } else {
            vscode.window.showWarningMessage('Rust Assist: Cargo not found on path, code diagnostics are disabled.');
        }
    });

    // ====================================================
    // Formatting
    // ====================================================

    format.hasPrerequisites().then(result => {
        if (result) {
            const formatManager = new format.FormatManager(config.formatMode());

            if (config.formatOnSave()) {
                context.subscriptions.push(
                    vscode.workspace.onDidSaveTextDocument(async (document: vscode.TextDocument) => {
                        if (document.languageId === 'rust') {
                            formatManager.formatFile(
                                projects.getParent(document.uri.fsPath),
                                document.uri.fsPath
                            );
                        }
                    })
                );
            }
        } else {
            vscode.window.showWarningMessage('Rust Assist: Rustfmt not found on path, formatting is disabled.');
        }
    });
}
