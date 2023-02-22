import * as vscode from "vscode";
import * as path from "path";

interface VerificationResultRaw {
    item_name: string,
    success: boolean,
    time_ms: number,
    cached: boolean,
}

export interface VerificationResult {
    methodName: string,
    success: boolean,
    time_ms: number,
    cached: boolean,
}

// currently the value given for itemName is "filename_methodpath"
// should this be done in rust?
function splitName(name: string) : [string, string] {
    // position of the underscore
    let position = name.search(".rs_") + 3;
    let filename = name.substring(0, position);
    let methodPath = name.substring(position+1);
    return [filename, methodPath]
}

function transformVerificationResult(rawRes: VerificationResultRaw, isCrate: boolean, rootPath: string) : VerificationResult {
    let [_fileName, methodPath] = splitName(rawRes.item_name);
    // we realized this fileName is not useful, for crates it's always main.rs
    let res = {
        methodName: methodPath,
        success: rawRes.success,
        time_ms: rawRes.time_ms,
        cached: rawRes.cached,
    };
    return res;
}

export function parseVerificationResult(line: string, isCrate: boolean, rootPath: string): VerificationResult | undefined {
    const token = "ideVerificationResult";
    if (!line.startsWith(token)) {
        return undefined;
    }
    let rawResult = JSON.parse(line.substring(token.length)) as VerificationResultRaw;
    return transformVerificationResult(rawResult, isCrate, rootPath);
}
