import * as util from "./util";
import * as config from "./config";
import * as vscode from "vscode";
import * as path from "path";
import * as dependencies from "./dependencies";
import {IdeInfo} from "./diagnostics";


export * from "./dependencies/PrustiLocation";
import * as tools from "vs-verification-toolbox";
import * as server from "./server";
import * as rustup from "./dependencies/rustup";
import { PrustiLocation } from "./dependencies/PrustiLocation";
import { prustiTools } from "./dependencies/prustiTools";
import { DiagnosticsManager } from "./diagnostics";


export function handle_ide_info(ide_info: IdeInfo | null) : void {
    util.log("hello from handle_ide_info");    
    
    vscode.languages.registerCodeLensProvider( 'rust', {
        provideCodeLenses(document: vscode.TextDocument, token: vscode.CancellationToken): vscode.CodeLens[] {
            const codeLenses: vscode.CodeLens[] = [];
            for (const fc of ide_info!.procedure_defs) {
                if (fc.filename === document.fileName) {
                    const codeLens = new vscode.CodeLens(fc.range);
                    codeLens.command = {
                        title: "▶ verify",
                        command: "prusti.verify",
                        // TODO: invoke selective verification here
                        //arguments: [document, fc.range]
                    };
                    codeLenses.push(codeLens);
                } else {
                    util.log("not applicable: " + fc.filename + " vs " + document.fileName);
                }
            }
            return codeLenses;
        }
    });        

    vscode.languages.registerCodeActionsProvider( 'rust', {
        provideCodeActions(document: vscode.TextDocument, range: vscode.Range, context: vscode.CodeActionContext, token: vscode.CancellationToken): vscode.CodeAction[] {
            util.log("Code Action range:" + range.start.line + ":" + range.start.character + " - " + range.end.line + ":" + range.end.character);
            const codeActions: vscode.CodeAction[] = [];
            for (const fc of ide_info!.function_calls) {
                util.log("against range of " + fc.name + " at");
                util.log("Code Action range:" + fc.range.start.line + ":" + fc.range.start.character + " - " + fc.range.end.line + ":" + fc.range.end.character);
                if (fc.filename === document.fileName && fc.range.contains(range)) {
                    util.log("Yes this one matches")
                    const codeAction = new vscode.CodeAction("create external specification", vscode.CodeActionKind.QuickFix);
                    // codeAction.command = {
                    //     title: "Verify",
                    //     command: "prusti.verify",
                    //     arguments: [document, range]
                    // };
                    codeActions.push(codeAction);
                }
            }
            return codeActions;
        }
    });

}

