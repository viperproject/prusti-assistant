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
            await diagnosticManager.refreshAll();
        })
    );

    if (config.checkOnSave()) {
        context.subscriptions.push(
            vscode.workspace.onDidSaveTextDocument(async (document: vscode.TextDocument) => {
                if (document.languageId === 'rust') {
                    await diagnosticManager.refreshAll();
                }
            })
        );
    }

    if (config.checkOnStartup()) {
        // TODO: This doesn't work on large projects for some reason.
        await diagnosticManager.refreshAll();
    }
}
