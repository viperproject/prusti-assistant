'use strict';

import * as vscode from 'vscode';
import * as config from './config';
import * as diagnostic from './diagnostics';

export function activate(context: vscode.ExtensionContext) {
    const rust_diagnostics = vscode.languages.createDiagnosticCollection("rust");
    const root_path = vscode.workspace.rootPath || './';
    const diagnostic_manager = new diagnostic.DiagnosticsManager(root_path, rust_diagnostics);

    context.subscriptions.push(
        vscode.commands.registerCommand('rust-assist.check', () => {
            diagnostic_manager.refreshDiagnostics();
        })
    );

    if (config.checkOnSave()) {
        context.subscriptions.push(
            vscode.workspace.onDidSaveTextDocument((document: vscode.TextDocument) => {
                switch (document.languageId) {
                    case 'rust':
                    case 'toml':
                        diagnostic_manager.refreshDiagnostics();
                }
            })
        );
    }

    if (config.checkOnStartup()) {
        diagnostic_manager.refreshDiagnostics();
    }
}
