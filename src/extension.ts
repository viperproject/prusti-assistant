'use strict';

import * as vscode from 'vscode';
import * as config from './config';
import * as util from './util';
import * as diagnostics from './diagnostics';
import * as format from './format';

export async function activate(context: vscode.ExtensionContext) {
    // Startup

    const projects = await util.findProjects();

    if (!projects.hasProjects()) {
        vscode.window.showWarningMessage('Rust Assist: No `Cargo.toml` files were found in the workspace, unable to start plugin.');
        return;
    }

    // Prerequisites checks

    const canDiagnostics = await diagnostics.hasPrerequisites();
    const canFormat = await format.hasPrerequisites();

    if (!canDiagnostics) {
        vscode.window.showWarningMessage('Rust Assist: Cargo not found on path, code diagnostics are disabled.');
    }
    if (!canFormat) {
        vscode.window.showWarningMessage('Rust Assist: Rustfmt not found on path, formatting is disabled.');
    }

    // Managers

    const diagnosticManager = new diagnostics.DiagnosticsManager(
        projects,
        vscode.languages.createDiagnosticCollection("rust")
    );
    const formatManager = new format.FormatManager(config.formatMode());

    // Event registration

    if (canDiagnostics) {
        // Diagnostics on command
        context.subscriptions.push(
            vscode.commands.registerCommand('rust-assist.refreshDiagnostics', async () => {
                diagnosticManager.refreshAll();
            })
        );

        // Diagnostics on startup
        if (config.diagnosticsOnStartup()) {
            diagnosticManager.refreshAll();
        }
    }

    // On save logic
    if (canDiagnostics || canFormat) {
        context.subscriptions.push(
            vscode.workspace.onDidSaveTextDocument(async (document: vscode.TextDocument) => {
                if (document.languageId === 'rust') {
                    // Formatting on save
                    if (canFormat && config.formatOnSave()) {
                        await formatManager.formatFile(
                            projects.getParent(document.uri.fsPath),
                            document.uri.fsPath
                        );
                    }

                    // Diagnostics on save
                    if (canDiagnostics && config.diagnosticsOnSave()) {
                        diagnosticManager.refreshAll();
                    }
                }
            })
        );
    }
}
