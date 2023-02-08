import * as vscode from "vscode";

export function successfulVerificationDecorationType() : vscode.TextEditorDecorationType {
    return vscode.window.createTextEditorDecorationType({
        gutterIconPath: '/home/cedric/prusti/prusti-assistant/resources/icons/check-circle-fat.svg',
        gutterIconSize: '80%'
    });
}
export function failedVerificationDecorationType() : vscode.TextEditorDecorationType {
    return vscode.window.createTextEditorDecorationType({
        gutterIconPath: '/home/cedric/prusti/prusti-assistant/resources/icons/x-circle-fat.svg',
        gutterIconSize: '80%'
    });
}

export function notVerifiedDecorationType() : vscode.TextEditorDecorationType {
    return vscode.window.createTextEditorDecorationType({
        gutterIconPath: '/home/cedric/prusti/prusti-assistant/resources/icons/help-circle-fat.svg',
        gutterIconSize: '80%'
    });
}
