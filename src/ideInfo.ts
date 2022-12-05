import * as util from "./util";
import * as vscode from "vscode";
import { IdeInfo } from "./diagnostics";
import { info } from "console";


export * from "./dependencies/PrustiLocation";

declare global {
    var ide_info_coll: IdeInfoCollection | null;
}

export class IdeInfoCollection {
    crates: Map<string, IdeInfo>;
    programs: Map<string, IdeInfo>;

    constructor() {
        this.crates = new Map();
        this.programs = new Map();
    }
}

export function add_ideinfo_program(program: string, ide_info: IdeInfo | null) : void {
    if (ide_info === null) {
        return;
    }
    if (global.ide_info_coll === null) {
        global.ide_info_coll = new IdeInfoCollection();
    }
    global.ide_info_coll.programs.set(program, ide_info);
    force_codelens_update();
}

export function add_ideinfo_crate(crate: string, ide_info: IdeInfo | null) : void {
    if (ide_info === null) {
        return;
    }
    if (global.ide_info_coll === null) {
        global.ide_info_coll = new IdeInfoCollection();
    }
    global.ide_info_coll.crates.set(crate, ide_info);
    force_codelens_update();
}

function collectInfos() : IdeInfo[] {
    if (global.ide_info_coll === null) {
        return [];
    }
    const infos = [];
    for (const info of global.ide_info_coll.crates.values()) {
        infos.push(info);
    }
    for (const info of global.ide_info_coll.programs.values()) {
        infos.push(info);
    }
    return infos;
}

export function setup_ide_info_handlers() : void {
    util.log("hello from handle_ide_info"); 
    global.ide_info_coll = new IdeInfoCollection();
    
    vscode.languages.registerCodeLensProvider( 'rust', {
        provideCodeLenses(document: vscode.TextDocument, _token: vscode.CancellationToken): vscode.CodeLens[] {
            const info_set = collectInfos();
            const codeLenses: vscode.CodeLens[] = [];
            info_set.forEach(info => {
                for (const fc of info.procedure_defs) {
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
            });
            return codeLenses;
        }
    });        

    vscode.languages.registerCodeActionsProvider( 'rust', {
        provideCodeActions(document: vscode.TextDocument, range: vscode.Range, context: vscode.CodeActionContext, token: vscode.CancellationToken): vscode.CodeAction[] {
            const info_set = collectInfos();
            // eslint-disable-next-line @typescript-eslint/restrict-plus-operands
            util.log("Code Action range:" + range.start.line + ":" + range.start.character + " - " + range.end.line + ":" + range.end.character);
            const codeActions: vscode.CodeAction[] = [];
            
            info_set.forEach(info => {
                for (const fc of info.function_calls) {
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
            });
            return codeActions;
        }
    });

}

export function force_codelens_update() : void {
    const cancel = vscode.languages.registerCodeLensProvider( 'rust', {
        provideCodeLenses(document: vscode.TextDocument, _token: vscode.CancellationToken): vscode.CodeLens[] {
            const codeLenses: vscode.CodeLens[] = [];
            return codeLenses;
        }
    }); 
    cancel.dispose();
}
