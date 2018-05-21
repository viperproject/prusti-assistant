'use strict';

import * as vscode from 'vscode';
import * as config from './config';
import * as diagnostic from './diagnostics';

export async function activate(context: vscode.ExtensionContext) {
    const rust_diagnostics = vscode.languages.createDiagnosticCollection("rust");
    const root_path = vscode.workspace.rootPath || './';
    const diagnostic_manager = new diagnostic.DiagnosticsManager(root_path, rust_diagnostics);

    context.subscriptions.push(
        vscode.commands.registerCommand('rust-assist.check', async () => {
            await diagnostic_manager.refreshDiagnostics();
        })
    );

    if (config.checkOnSave()) {
        context.subscriptions.push(
            vscode.workspace.onDidSaveTextDocument(async (document: vscode.TextDocument) => {
                switch (document.languageId) {
                    case 'rust':
                    case 'toml':
                        await diagnostic_manager.refreshDiagnostics();
                }
            })
        );
    }

    if (config.checkOnStartup()) {
        await diagnostic_manager.refreshDiagnostics();
    }
}
