import * as util from "./util";
import * as vscode from "vscode";
import { IdeInfo, ProcDef } from "./diagnostics";
import { EventEmitter } from "events";
import {notVerifiedDecorationType, failedVerificationDecorationType, successfulVerificationDecorationType} from "./toolbox/decorations";


// Information from the compiler that can be obtained without invoking verification
interface CompilerInfoCollection {
    // for proc_defs we also have a boolean on whether these values
    // were already requested (for codelenses)
    proc_defs: Map<string, [boolean, ProcDef[]]>,
    fn_calls: Map<string, ProcDef[]>,
}

const updateEmitter = new EventEmitter();

export var ide_info_coll: CompilerInfoCollection = {
    proc_defs: new Map(),
    fn_calls : new Map(),
}

export function add_ideinfo(ide_info: IdeInfo | null): void {
    // a new invocation of prusti finished and returned some (updated) information
    if (ide_info === null) {
        return;
    }

    if (ide_info.queried_source) {
        // yet to be formatted:
        vscode.env.clipboard.writeText(ide_info.queried_source);
        util.userInfoPopup("Template for extern spec. is now on your Clipboard.");
    }
    ide_info.procedure_defs.forEach((procdef: ProcDef[], filename: string) => {
        util.log("Processing a procdef with length: " + procdef.length);
        // the boolean we are inserting stands for whether or not the info
        // of this file has been read already
        ide_info_coll.proc_defs.set(filename, [false, procdef]); // replace all the infos for that file
        updateEmitter.emit('updated' + filename);
    });
    ide_info.function_calls.forEach((procdef: ProcDef[], filename: string) => {
        ide_info_coll.fn_calls.set(filename, procdef);
    })
    force_codelens_update();


    // while we are at it, let's try displaying checkmarks in gutter
    let active_editor = vscode.window.activeTextEditor;
    let filename = active_editor?.document.fileName;
    if ( filename !== undefined ) {
        let ranges = collect_ranges(filename);
        active_editor?.setDecorations(successfulVerificationDecorationType(), ranges);
        util.log("Trying to set decorations!");
    }



    // if (active_editor) {
    //     ide_info.procedure_defs.forEach((procdef: ProcDef[], filename: string) => {
    //         procdef.forEach((pd: ProcDef) => {
    //             if ( pd.filename == filename ) {
    //                 active_editor?.setDecorations(verifiedDecorationType, [pd.range])
    //                 util.log("Setting a decoration for Range: " + pd.range);
    //             }
    //         })
    //     })
    // }

}


async function codelensPromise(
  document: vscode.TextDocument,
  _token: vscode.CancellationToken
): Promise<vscode.CodeLens[]> {
    const codeLenses: vscode.CodeLens[] = [];
    let lookup = ide_info_coll.proc_defs.get(document.fileName);

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

        let procdefs: ProcDef[] = lookup[1];
        procdefs.forEach((pc: ProcDef) => {
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

export function setup_ide_info_handlers(): void {
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
            context: vscode.CodeActionContext,
            token: vscode.CancellationToken
        ): vscode.CodeAction[] {
            const codeActions: vscode.CodeAction[] = [];

            let lookup = ide_info_coll.fn_calls.get(document.fileName);

            if (lookup !== undefined ) {
                let procdefs: ProcDef[] = lookup;
                procdefs.forEach((fc: ProcDef) => {
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

function force_codelens_update(): void {
    const cancel = vscode.languages.registerCodeLensProvider('rust', {
        provideCodeLenses(_document: vscode.TextDocument, _token: vscode.CancellationToken): vscode.CodeLens[] {
            const codeLenses: vscode.CodeLens[] = [];
            return codeLenses;
        }
    });
    cancel.dispose();
}

function collect_ranges(filename: string): vscode.Range[] {
    let res: vscode.Range[] = []
    ide_info_coll.proc_defs.forEach(([_, proc_defs]: [boolean, ProcDef[]], file: string) => {
        if (filename == file) {
            proc_defs.forEach((pd) => {
                res.push(first_symbol_range(pd.range));
            })
        }
    })
    return res;
}

function first_symbol_range(range: vscode.Range): vscode.Range {
    let position = new vscode.Position(range.start.line, range.start.character);
    return new vscode.Range(position, position)
}
