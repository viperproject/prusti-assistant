'use strict';

import * as vscode from 'vscode';
import * as config from './config';
import * as diagnostic from './diagnostics';

export function activate(context: vscode.ExtensionContext) {
    const rust_diagnostics = vscode.languages.createDiagnosticCollection("rust");

    context.subscriptions.push(
        vscode.commands.registerCommand('rust-assist.check', () => {
            diagnostic.refreshDiagnostics(rust_diagnostics);
        })
    );

    if (config.checkOnSave()) {
        context.subscriptions.push(
            vscode.workspace.onDidSaveTextDocument((document: vscode.TextDocument) => {
                switch (document.languageId) {
                    case 'rust':
                    case 'toml':
                        diagnostic.refreshDiagnostics(rust_diagnostics);
                }
            })
        );
    }

    if (config.checkOnStartup()) {
        diagnostic.refreshDiagnostics(rust_diagnostics);
        diagnostic.refreshDiagnostics(rust_diagnostics);
    }
}
