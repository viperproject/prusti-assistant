import * as vscode from "vscode";

export function successfulVerificationDecorationType(time: number, cached: boolean) : vscode.TextEditorDecorationType {
    const basepath = vscode.Uri.parse(__dirname);
    const icon = vscode.Uri.joinPath(basepath, "..", "resources", "icons", "check-circle-fat.svg")
    return vscode.window.createTextEditorDecorationType({
        gutterIconPath: icon,
        gutterIconSize: '80%',
        after: timeAndCacheDecorator(time, cached, true),
    });
}
export function failedVerificationDecorationType(time: number, cached: boolean) : vscode.TextEditorDecorationType {
    const basepath = vscode.Uri.parse(__dirname);
    const icon = vscode.Uri.joinPath(basepath, "..", "resources", "icons", "x-circle-fat.svg")
    return vscode.window.createTextEditorDecorationType({
        gutterIconPath: icon,
        gutterIconSize: '80%',
        after: timeAndCacheDecorator(time, cached, false),
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

function timeAndCacheDecorator(time: number, cached: boolean, success: boolean) : vscode.ThemableDecorationAttachmentRenderOptions {
    const cachedStr = cached ? " (cached)":"";
    let text;
    if (success) {
        text = `  [Verified in ${time} ms${cachedStr}]`;
    } else {
        text = `  [Failed verification in ${time} ms${cachedStr}]`;
    }
    return {
        contentText: text,
        color: "gray",
        fontWeight: "0.8"
    }
}

export function successfulVerificationTextDecorationType(time: number, cached: boolean) : vscode.TextEditorDecorationType {
    return vscode.window.createTextEditorDecorationType({
        after: timeAndCacheDecorator(time, cached, true),
    });
}
export function failedVerificationTextDecorationType(time: number, cached: boolean) : vscode.TextEditorDecorationType {
    return vscode.window.createTextEditorDecorationType({
        after: timeAndCacheDecorator(time, cached, false),
    });
}

// Decorations for different partial verification states
function successfulCompleteVerificationDecorationType() : vscode.TextEditorDecorationType {
    const basepath = vscode.Uri.parse(__dirname);
    const icon = vscode.Uri.joinPath(basepath, "..", "resources", "icons", "green-bars.svg")
    return vscode.window.createTextEditorDecorationType({
        gutterIconPath: icon,
        gutterIconSize: '100%',
    });
}
export const _successfulCompleteVerificationDecorationType = successfulCompleteVerificationDecorationType();

function successfulCompleteVerificationStartDecorationType() : vscode.TextEditorDecorationType {
    const basepath = vscode.Uri.parse(__dirname);
    const icon = vscode.Uri.joinPath(basepath, "..", "resources", "icons", "top-half-circle-green.svg")
    return vscode.window.createTextEditorDecorationType({
        gutterIconPath: icon,
        gutterIconSize: '100%',
    });
}
export const _successfulCompleteVerificationStartDecorationType = successfulCompleteVerificationStartDecorationType();

function successfulCompleteVerificationEndDecorationType() : vscode.TextEditorDecorationType {
    const basepath = vscode.Uri.parse(__dirname);
    const icon = vscode.Uri.joinPath(basepath, "..", "resources", "icons", "bottom-half-circle-green.svg")
    return vscode.window.createTextEditorDecorationType({
        gutterIconPath: icon,
        gutterIconSize: '100%',
    });
}
export const _successfulCompleteVerificationEndDecorationType = successfulCompleteVerificationEndDecorationType();

function successfulPartialVerificationDecorationType() : vscode.TextEditorDecorationType {
    const basepath = vscode.Uri.parse(__dirname);
    const icon = vscode.Uri.joinPath(basepath, "..", "resources", "icons", "green-stripes-between-bars.svg")
    return vscode.window.createTextEditorDecorationType({
        gutterIconPath: icon,
        gutterIconSize: '100%',
    });
}
export const _successfulPartialVerificationDecorationType = successfulPartialVerificationDecorationType();

function failedPartialVerificationDecorationType() : vscode.TextEditorDecorationType {
  const basepath = vscode.Uri.parse(__dirname);
  const icon = vscode.Uri.joinPath(basepath, "..", "resources", "icons", "red-between-bars.svg")
  return vscode.window.createTextEditorDecorationType({
    gutterIconPath: icon,
    gutterIconSize: '100%',
  });
}
export const _failedPartialVerificationDecorationType = failedPartialVerificationDecorationType();

function declarationRangeDecorationType() : vscode.TextEditorDecorationType {
    const basepath = vscode.Uri.parse(__dirname);
    const icon = vscode.Uri.joinPath(basepath, "..", "resources", "icons", "orange-bars.svg")
    return vscode.window.createTextEditorDecorationType({
        gutterIconPath: icon,
        gutterIconSize: '100%',
    });
}
export const _declarationRangeDecorationType = declarationRangeDecorationType();

function declarationRangeStartVerificationDecorationType() : vscode.TextEditorDecorationType {
    const basepath = vscode.Uri.parse(__dirname);
    const icon = vscode.Uri.joinPath(basepath, "..", "resources", "icons", "top-closed-orange-bars.svg")
    return vscode.window.createTextEditorDecorationType({
        gutterIconPath: icon,
        gutterIconSize: '100%',
    });
}
export const _declarationRangeStartVerificationDecorationType = declarationRangeStartVerificationDecorationType();

function declarationRangeEndlVerificationDecorationType() : vscode.TextEditorDecorationType {
    const basepath = vscode.Uri.parse(__dirname);
    const icon = vscode.Uri.joinPath(basepath, "..", "resources", "icons", "bottom-closed-orange-bars.svg")
    return vscode.window.createTextEditorDecorationType({
        gutterIconPath: icon,
        gutterIconSize: '100%',
    });
}
export const _declarationRangeEndlVerificationDecorationType = declarationRangeEndlVerificationDecorationType();
