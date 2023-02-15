import * as vscode from "vscode";
import * as util from "./../util";
import { EventEmitter } from "events";
import { infoCollection } from "./infoCollection"
import { VerificationResult } from "./verificationResult";
import { failedVerificationDecorationType, successfulVerificationDecorationType } from "./../toolbox/decorations";
import { FunctionRef } from "./compilerInfo";


export const updateEmitter = new EventEmitter();


// for CodeLenses and CodeActions we need to set up handlers
// at the beginning, to display information later
export function setup_handlers(): void {

    vscode.languages.registerCodeLensProvider('rust', {
        provideCodeLenses(document: vscode.TextDocument, _token: vscode.CancellationToken): Promise<vscode.CodeLens[]> {
            return codelensPromise(document, _token);
        }
    });

    vscode.languages.registerCodeActionsProvider('rust', {
        provideCodeActions(
            document: vscode.TextDocument,
            range: vscode.Range,
            _context: vscode.CodeActionContext,
            _token: vscode.CancellationToken
        ): vscode.CodeAction[] {
            const codeActions: vscode.CodeAction[] = [];

            // figure out whether or not this file is part of a crate, or a
            // standalone file
            let rootPath = infoCollection.getRootPath(document.uri.fsPath);
            let lookup = infoCollection.functionCalls.get(rootPath);


            if (lookup !== undefined ) {
                let procdefs: FunctionRef[] = lookup;
                procdefs.forEach((fc: FunctionRef) => {
                    if (fc.fileName === document.fileName && fc.range.contains(range))
                    {
                        const codeAction = new vscode.CodeAction(
                            "create external specification " + fc.identifier,
                            vscode.CodeActionKind.QuickFix
                        );
                        codeAction.command = {
                            title: "Verify",
                            command: "prusti-assistant.query-method-signature",
                            arguments: [fc.identifier]
                        };
                        codeActions.push(codeAction);
                    }
                });
            }
            return codeActions;
        }
    });
}

async function codelensPromise(
  document: vscode.TextDocument,
  _token: vscode.CancellationToken
): Promise<vscode.CodeLens[]> {
    const codeLenses: vscode.CodeLens[] = [];
    let rootPath = infoCollection.getRootPath(document.uri.fsPath);
    let procDefs = infoCollection.procedureDefs.get(rootPath);
    let fileState = infoCollection.fileStateMap.get(document.uri.fsPath);


    if (fileState !== undefined ) {
        if (fileState) {
            // it has already been read and we should wait for
            // an update. Should there be an await?
            await new Promise(resolve => {
                updateEmitter.once('updated' + document.uri.fsPath, () => resolve );
            });
        } // otherwise just proceed since this file's current info has not been
          // read yet..

        infoCollection.fileStateMap.set(document.uri.fsPath, true);

        procDefs?.forEach((pd: FunctionRef) => {
            if (pd.fileName === document.uri.fsPath) {
                const codeLens = new vscode.CodeLens(pd.range);
                codeLens.command = { 
                    title: "✓ Verify " + pd.identifier,
                    command: "prusti-assistant.verify-selective",
                    // TODO: invoke selective verification here
                    arguments: [pd.identifier]
                };
                codeLenses.push(codeLens);
            }
        });
    }
    // await delay(0);
    return codeLenses;
}

export function displayResults() {
    let activeEditor = vscode.window.activeTextEditor;
    let editorFilePath = activeEditor?.document.uri.fsPath;
    if (editorFilePath !== undefined) {
        let rootPath = infoCollection.getRootPath(editorFilePath);
        let decorators: vscode.TextEditorDecorationType[] = [];
        clearPreviousDecorators(editorFilePath);
        let resultList = infoCollection.verificationInfo.get(rootPath);
        resultList?.forEach((res: VerificationResult) => {
            let location = infoCollection.getLocation(rootPath, res.methodName);
            if (location) {
                let [range, resFilePath] = location;
                if (resFilePath === editorFilePath) {
                    let range_line = full_line_range(range);
                    var decoration;
                    if (res.success) {
                        decoration = successfulVerificationDecorationType(res.time_ms, res.cached)
                    } else {
                        decoration = failedVerificationDecorationType(res.time_ms, res.cached)
                    }
                    activeEditor?.setDecorations(decoration, [range_line]);
                    decorators.push(decoration);
                }
            } else {
                util.log(`Couldn't find location for method ${res.methodName} in ${rootPath}`);
            }
        });
        infoCollection.decorations.set(editorFilePath, decorators);
    }
}

function clearPreviousDecorators(filePath: string) {
    let prev = infoCollection.decorations.get(filePath);
    if (prev !== undefined) {
        prev.forEach((dec: vscode.TextEditorDecorationType) => {
            vscode.window.activeTextEditor?.setDecorations(dec, []);
        });
    }

}

/**
 * very primitive way of causing a re-rendering of the Codelenses in the
 * current file. This was needed because in some cases it took quite a few
 * seconds until they were updated.
 */
export function force_codelens_update(): void {
    const cancel = vscode.languages.registerCodeLensProvider('rust', {
        provideCodeLenses(_document: vscode.TextDocument, _token: vscode.CancellationToken): vscode.CodeLens[] {
            const codeLenses: vscode.CodeLens[] = [];
            return codeLenses;
        }
    });
    cancel.dispose();
}

/**
 * Given a range, possibly spanning multiple lines this function will return a range
 * that includes all of the last line. The purpose of this is that decorators
 * that are displayed "behind" this range, will not be in the middle of some text
 */
function full_line_range(range: vscode.Range): vscode.Range {
    let position = new vscode.Position(range.start.line, range.start.character);
    let position_test = new vscode.Position(range.start.line, Number.MAX_SAFE_INTEGER);

    return new vscode.Range(position, position_test)
}
