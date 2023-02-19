import * as vscode from "vscode";

export interface PrustiLineConsumer extends vscode.Disposable {
    tryConsumeLine: (line: string, isCrate: boolean, programPath: string) => boolean
}
