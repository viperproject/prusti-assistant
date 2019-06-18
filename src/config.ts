import * as vscode from 'vscode';

function config(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration('prusti-assistant');
}

export function cargoPrustiPath(): string {
    return config().get('cargoPrustiPath', 'cargo-prusti');
}

export function verifyOnSave(): boolean {
    return config().get('verifyOnSave', true);
}

export function verifyOnStartup(): boolean {
    return config().get('verifyOnStartup', true);
}

export function reportErrorsOnly(): boolean {
    return config().get('reportErrorsOnly', true);
}
