import { ProcDef } from "./compilerInfo";
import * as vscode from "vscode";
import { VerificationInfo } from "./verificationSummary";

// Information from the compiler that can be obtained without invoking verification
export interface InfoCollection {
    // for proc_defs we also have a boolean on whether these values 
    // were already requested (for codelenses)
    procDefs: Map<string, [boolean, ProcDef[]]>,
    fnCalls: Map<string, ProcDef[]>,
    verificationInfo: VerificationInfo,
    rangeMap: Map<[string, string], vscode.Range>
}

export var infoCollection: InfoCollection = {
    procDefs: new Map(),
    fnCalls: new Map(),
    verificationInfo: [],
    rangeMap: new Map(), 

}
