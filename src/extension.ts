'use strict';

import * as vscode from 'vscode';
import * as config from './config';
import * as util from './util';
import * as diagnostics from './diagnostics';

export async function activate(context: vscode.ExtensionContext) {
    const rustDiagnostics = vscode.languages.createDiagnosticCollection("rust");
    const rootPaths = await util.getRootPaths();
    const diagnosticManager = new diagnostics.DiagnosticsManager(rootPaths, rustDiagnostics);

    context.subscriptions.push(
        vscode.commands.registerCommand('rust-assist.check', async () => {
            await diagnosticManager.refresh();
        })
    );

    if (config.checkOnSave()) {
        context.subscriptions.push(
            vscode.workspace.onDidSaveTextDocument(async (document: vscode.TextDocument) => {
                if (document.languageId === 'rust') {
                    await diagnosticManager.refresh();
                }
            })
        );
    }

    if (config.checkOnStartup()) {
        await diagnosticManager.refresh();
    }
}
