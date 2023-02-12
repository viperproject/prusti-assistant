import * as util from "./../util";
import * as vscode from "vscode";
import { ProcDef, CompilerInfo, parseCompilerInfo } from "./compilerInfo"
import { parseVerificationInfo } from "./verificationInfo"
import * as display from "./display";
import { infoCollection } from "./infoCollection";




export function process_output(rootPath: string, output: string, isCrate: boolean) {

    let compilerInfo = null;
    if (isCrate) {
        compilerInfo = parseCompilerInfo(output, rootPath);
    } else {
        compilerInfo = parseCompilerInfo(output, "");
    }
    addCompilerInfo(compilerInfo);

    infoCollection.verificationInfo = parseVerificationInfo(output, isCrate, rootPath);

    util.log("\n\n\nrootPath: " + rootPath);
    display.displayResults()

}

export function addCompilerInfo(info: CompilerInfo | null): void {
    // a new invocation of prusti finished and returned some (updated) information
    if (info === null) {
        return;
    }

    if (info.queried_source) {
        // yet to be formatted:
        vscode.env.clipboard.writeText(info.queried_source);
        util.userInfoPopup("Template for extern spec. is now on your Clipboard.");
    }
    info.procedure_defs.forEach((procdefs: ProcDef[], filename: string) => {
        util.log("Processing a procdef with length: " + procdefs.length);
        // the boolean we are inserting stands for whether or not the info
        // of this file has been read already
        infoCollection.procDefs.set(filename, [false, procdefs]); // replace all the infos for that file
        display.updateEmitter.emit('updated' + filename);
        procdefs.forEach((procDef: ProcDef) => {
            util.log("Setting rangemap: " + procDef.filename + ": " + procDef.name);
            infoCollection.rangeMap.set(procDef.filename + ":" + procDef.name, procDef.range);
        });
    });
    info.function_calls.forEach((procdef: ProcDef[], filename: string) => {
        infoCollection.fnCalls.set(filename, procdef);
    });
    display.force_codelens_update();


}


