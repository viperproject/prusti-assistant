import * as vscode from 'vscode';

function config(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration('rust-assist');
}

export function diagnosticsOnStartup(): boolean {
    return config().get('diagnosticsOnStartup', true);
}

export function diagnosticsOnSave(): boolean {
    return config().get('diagnosticsOnSave', true);
}
