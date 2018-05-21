'use strict';

import * as vscode from 'vscode';
import * as config from './config';
import * as util from './util';
import * as diagnostic from './diagnostics';

export async function activate(context: vscode.ExtensionContext) {
    const rust_diagnostics = vscode.languages.createDiagnosticCollection("rust");
    const root_path = await util.getRootPath();
    const diagnostic_manager = new diagnostic.DiagnosticsManager(root_path, rust_diagnostics);

    context.subscriptions.push(
        vscode.commands.registerCommand('rust-assist.check', async () => {
            await diagnostic_manager.refreshDiagnostics();
        })
    );

    if (config.checkOnSave()) {
        context.subscriptions.push(
            vscode.workspace.onDidSaveTextDocument(async (document: vscode.TextDocument) => {
                if (document.languageId === 'rust') {
                    await diagnostic_manager.refreshDiagnostics();
                }
            })
        );
    }

    if (config.checkOnStartup()) {
        await diagnostic_manager.refreshDiagnostics();
    }
}
