'use strict';

import * as vscode from 'vscode';
import * as config from './config';
import * as util from './util';
import * as diagnostics from './diagnostics';
import * as format from './format';

export async function activate(context: vscode.ExtensionContext) {
    const rootPaths = await util.findRootPaths();

    if (rootPaths.length === 0) {
        vscode.window.showWarningMessage('Rust Assist: No `Cargo.toml` files were found in the workspace, unable to start plugin.');
        return;
    }

    // ====================================================
    // Diagnostics
    // ====================================================

    const rustDiagnostics = vscode.languages.createDiagnosticCollection("rust");
    const diagnosticManager = new diagnostics.DiagnosticsManager(rootPaths, rustDiagnostics);

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

    // ====================================================
    // Formatting
    // ====================================================

    if (await format.hasPrerequisites()) {
        const formatManager = new format.FormatManager(rootPaths, config.formatMode());

        if (config.formatOnSave()) {
            context.subscriptions.push(
                vscode.workspace.onDidSaveTextDocument(async (document: vscode.TextDocument) => {
                    if (document.languageId === 'rust') {
                        formatManager.format(document.uri.fsPath);
                    }
                })
            );
        }
    } else {
        vscode.window.showWarningMessage('Rust Assist: Rustfmt not found on path, formatting is disabled.');
    }
}
