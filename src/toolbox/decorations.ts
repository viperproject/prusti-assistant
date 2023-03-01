import * as vscode from "vscode";

export function successfulVerificationDecorationType(time: number, cached: boolean) : vscode.TextEditorDecorationType {
    const basepath = vscode.Uri.parse(__dirname);
    const icon = vscode.Uri.joinPath(basepath, "..", "resources", "icons", "check-circle-fat.svg")
    return vscode.window.createTextEditorDecorationType({
        gutterIconPath: icon,
        gutterIconSize: '80%',
        after: timeAndCacheDecorator(time, cached),
    });
}
export function failedVerificationDecorationType(time: number, cached: boolean) : vscode.TextEditorDecorationType {
    const basepath = vscode.Uri.parse(__dirname);
    const icon = vscode.Uri.joinPath(basepath, "..", "resources", "icons", "x-circle-fat.svg")
    return vscode.window.createTextEditorDecorationType({
        gutterIconPath: icon,
        gutterIconSize: '80%',
        after: timeAndCacheDecorator(time, cached),
    });
}

// For items that were not verified at all we could also display some sort of symbol
// but it might be even more clear that nothing was done with an item if
// we don't display anything.
export function notVerifiedDecorationType() : vscode.TextEditorDecorationType {
    const basepath = vscode.Uri.parse(__dirname);
    const icon = vscode.Uri.joinPath(basepath, "..", "resources", "icons", "check-circle-fat.svg")
    return vscode.window.createTextEditorDecorationType({
        gutterIconPath: icon,
        gutterIconSize: '80%',
    });
}

function timeAndCacheDecorator(time: number, cached: boolean) : vscode.ThemableDecorationAttachmentRenderOptions {
    const cachedStr = cached ? " (cached)":"";
    const text = `  [Verified in ${time} ms${cachedStr}]`;
    return {
        contentText: text,
        color: "gray",
        fontWeight: "0.8"
    }
}



