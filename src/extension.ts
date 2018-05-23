'use strict';

import * as vscode from 'vscode';
import * as config from './config';
import * as util from './util';
import * as diagnostics from './diagnostics';

export async function activate(context: vscode.ExtensionContext) {
    const rootPaths = await util.getRootPaths();

    if (rootPaths.length === 0) {
        vscode.window.showWarningMessage('Rust Assist: No `Cargo.toml` files were found in the workspace.');
    }

    const rustDiagnostics = vscode.languages.createDiagnosticCollection("rust");
    const diagnosticManager = new diagnostics.DiagnosticsManager(rootPaths, rustDiagnostics);

    context.subscriptions.push(
        vscode.commands.registerCommand('rust-assist.refreshDiagnostics', async () => {
            await diagnosticManager.refreshAll();
        })
    );

    if (config.diagnosticsOnSave()) {
        context.subscriptions.push(
            vscode.workspace.onDidSaveTextDocument(async (document: vscode.TextDocument) => {
                if (document.languageId === 'rust') {
                    await diagnosticManager.refreshAll();
                }
            })
        );
    }

    if (config.diagnosticsOnStartup()) {
        await diagnosticManager.refreshAll();
    }
}
