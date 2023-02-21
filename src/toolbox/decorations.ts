import * as vscode from "vscode";
import * as util from "./../util";

export function successfulVerificationDecorationType(time: number, cached: boolean) : vscode.TextEditorDecorationType {
    let basepath = vscode.Uri.parse(__dirname);
    let icon = vscode.Uri.joinPath(basepath, "..", "resources", "icons", "check-circle-fat.svg")
    return vscode.window.createTextEditorDecorationType({
        gutterIconPath: icon,
        gutterIconSize: '80%',
        after: timeAndCacheDecorator(time, cached),
    });
}
export function failedVerificationDecorationType(time: number, cached: boolean) : vscode.TextEditorDecorationType {
    let basepath = vscode.Uri.parse(__dirname);
    let icon = vscode.Uri.joinPath(basepath, "..", "resources", "icons", "x-circle-fat.svg")
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
    let basepath = vscode.Uri.parse(__dirname);
    let icon = vscode.Uri.joinPath(basepath, "..", "resources", "icons", "check-circle-fat.svg")
    return vscode.window.createTextEditorDecorationType({
        gutterIconPath: icon,
        gutterIconSize: '80%',
    });
}

function timeAndCacheDecorator(time: number, cached: boolean) : vscode.ThemableDecorationAttachmentRenderOptions {
    let cachedStr = cached ? " (cached)":"";
    let text = `  [Verified in ${time} ms${cachedStr}]`;
    return {
        contentText: text,
        color: "gray",
        fontWeight: "0.8"
    }
}



