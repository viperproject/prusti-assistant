import * as util from "./util";
import * as vscode from "vscode";
import {IdeInfo} from "./diagnostics";


export * from "./dependencies/PrustiLocation";

declare global {
    var ide_info: IdeInfo | null;
}


export function setup_ide_info_handlers() : void {
    util.log("hello from handle_ide_info");    
    
    vscode.languages.registerCodeLensProvider( 'rust', {
        provideCodeLenses(document: vscode.TextDocument, _token: vscode.CancellationToken): vscode.CodeLens[] {
            const codeLenses: vscode.CodeLens[] = [];
            if (global.ide_info !== null) {
                for (const fc of global.ide_info.procedure_defs) {
                    if (fc.filename === document.fileName) {
                        const codeLens = new vscode.CodeLens(fc.range);
                        codeLens.command = {
                            title: "▶ verify " + fc.name,
                            command: "prusti-assistant.verify-selective",
                            // TODO: invoke selective verification here
                            arguments: [fc.name]
                        };
                        codeLenses.push(codeLens);
                    } else {
                        util.log("not applicable: " + fc.filename + " vs " + document.fileName);
                    }
                }
            }
            return codeLenses;
        }
    });        

    vscode.languages.registerCodeActionsProvider( 'rust', {
        provideCodeActions(document: vscode.TextDocument, range: vscode.Range, context: vscode.CodeActionContext, token: vscode.CancellationToken): vscode.CodeAction[] {
            // eslint-disable-next-line @typescript-eslint/restrict-plus-operands
            util.log("Code Action range:" + range.start.line + ":" + range.start.character + " - " + range.end.line + ":" + range.end.character);
            const codeActions: vscode.CodeAction[] = [];
            
            if (global.ide_info !== null) {
                for (const fc of global.ide_info.function_calls) {
                    util.log("against range of " + fc.name + " at");
                    // eslint-disable-next-line @typescript-eslint/restrict-plus-operands
                    util.log("Code Action range:" + fc.range.start.line + ":" + fc.range.start.character + " - " + fc.range.end.line + ":" + fc.range.end.character);
                    if (fc.filename === document.fileName && fc.range.contains(range)) {
                        util.log("Yes this one matches")
                        const codeAction = new vscode.CodeAction(
                            "create external specification " + fc.name,
                            vscode.CodeActionKind.QuickFix
                        );
                        
                        // codeAction.command = {
                        //     title: "Verify",
                        //     command: "prusti.verify",
                        //     arguments: [document, range]
                        // };
                        codeActions.push(codeAction);
                    }
                }
            } 
            return codeActions;
        }
    });

}

