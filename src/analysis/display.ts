import * as vscode from "vscode";
import * as ci from "./compilerInfo";
import * as util from "./../util";
import { EventEmitter } from "events";
import { InfoCollection, infoCollection } from "./infoCollection"
import { VerificationResult } from "./verificationInfo";
import { notVerifiedDecorationType, failedVerificationDecorationType, successfulVerificationDecorationType } from "./../toolbox/decorations";


export const updateEmitter = new EventEmitter();

// for CodeLenses and CodeActions we need to set up handlers
// at the beginning, to display information later
export function setup_handlers(): void {
    util.log("setting up CodeLenses and CodeActions");

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
            
            let lookup = infoCollection.fnCalls.get(document.fileName);
            
            if (lookup !== undefined ) {
                let procdefs: ci.ProcDef[] = lookup;
                procdefs.forEach((fc: ci.ProcDef) => {
                    if (fc.filename === document.fileName && fc.range.contains(range)) 
                    {
                        const codeAction = new vscode.CodeAction(
                            "create external specification " + fc.name,
                            vscode.CodeActionKind.QuickFix
                        );
                        codeAction.command = {
                            title: "Verify",
                            command: "prusti-assistant.query-method-signature",
                            arguments: [fc.name]
                        };
                        codeActions.push(codeAction);
                    }
                });
            }
            return codeActions;
        }
    });

}

export function displayResults() {
    let active_editor = vscode.window.activeTextEditor;
    let filename = active_editor?.document.fileName;
    util.log("Found nr of verification results: " + infoCollection.verificationInfo.length)
    infoCollection.verificationInfo.forEach((res: VerificationResult) => {
        util.log("display result: " + res.fileName + ": "+ res.methodName);
        util.log("editor filename: " + filename);
        if (res.fileName != filename) {
            return;
        }
        let range = infoCollection.rangeMap.get(res.fileName + ":" + res.methodName);
        if (range) {
            let range_line = full_line_range(range);
            if (res.success) {
                active_editor?.setDecorations(successfulVerificationDecorationType(res.time_ms, res.cached), [range_line]);
            } else {
                active_editor?.setDecorations(failedVerificationDecorationType(res.time_ms, res.cached), [range_line]);
            }
        } else {
            util.log("didnt find a range for this file");
        }
    });
    // display_test();
}

function display_test() {
    let pos1 = new vscode.Position(1,1);
    let pos2 = new vscode.Position(5,0);
    let ranges = [new vscode.Range(pos1, pos1)];

    let decorationType = vscode.window.createTextEditorDecorationType({});

    let activeEditor = vscode.window.activeTextEditor;

    if (activeEditor) {
        let decorations = ranges.map(range => {
            return {
                range,
                gutterText: 'Success'
            };
        });

        activeEditor.setDecorations(decorationType, decorations);
    }
}

async function codelensPromise(
  document: vscode.TextDocument, 
  _token: vscode.CancellationToken
): Promise<vscode.CodeLens[]> {
    const codeLenses: vscode.CodeLens[] = [];
    let lookup = infoCollection.procDefs.get(document.fileName);
    
    if (lookup !== undefined ) {
        if (lookup[0]) {
            util.log("Trying to get info for file that has been read before");
            // it has already been read and we should wait for
            // an update. Should there be an await?
            await new Promise(resolve => {
                updateEmitter.once('updated' + document.fileName, () => resolve );
            });
        } // otherwise just proceed since this file's current info has not been
          // read yet..
        util.log("Proceeding to build Codelenses");

        lookup[0] = true;

        let procdefs: ci.ProcDef[] = lookup[1];
        procdefs.forEach((pc: ci.ProcDef) => {
            const codeLens = new vscode.CodeLens(pc.range);
            codeLens.command = { 
                title: "✓ verify " + pc.name,
                command: "prusti-assistant.verify-selective",
                // TODO: invoke selective verification here
                arguments: [pc.name]
            };
            codeLenses.push(codeLens);
        });
    }
    // await delay(0);
    return codeLenses;
}

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
    * Given a range, possibly spanning multiple lines
* this function will return a range that includes all of 
* the last line. The purpose of this is that decorators
* that are displayed "behind" this range, will not 
* be in the middle of some text
*/
function full_line_range(range: vscode.Range): vscode.Range {
    let position = new vscode.Position(range.start.line, range.start.character);
    let position_test = new vscode.Position(range.start.line, Number.MAX_SAFE_INTEGER);

    return new vscode.Range(position, position_test)
}
