import * as util from "./../util";
import * as vscode from "vscode";
import * as path from "path";

interface VerificationInfoRaw {
    result_list: VerificationResultRaw[]
}

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
    util.log("verification info with filename: " + filename);
    let methodPath = name.substring(position+1);
    return [filename, methodPath]
}

function transformVerificationResult(rawResults: VerificationResultRaw[], isCrate: boolean, rootPath: string) : VerificationResult[] {
    let dirPath: string;
    if (isCrate) {
        dirPath = rootPath;
    } else {
        dirPath = path.dirname(rootPath) + "/";
    }

    let results: VerificationResult[] = [];
    rawResults.forEach((rawRes) => {
        let [_fileName, methodPath] = splitName(rawRes.item_name);
        // we realized this fileName is not useful, for crates it's always main.rs
        let res = {
            methodName: methodPath,
            success: rawRes.success,
            time_ms: rawRes.time_ms,
            cached: rawRes.cached,
        };
        results.push(res);
    });
    return results;
}

export function parseVerificationResult(output: string, isCrate: boolean, rootPath: string): VerificationResult[] {
    let token = "VerificationInfo ";
    let len = token.length;
    for (const line of output.split("\n")) {
        if (!line.startsWith(token)) {
            continue;
        }

        let rawResult = JSON.parse(line.substring(len)) as VerificationInfoRaw;
        if (rawResult.result_list !== undefined) {
            util.log("Parsed verification summary. Found"
                    + rawResult.result_list.length
                    + " verification-results.");
            return transformVerificationResult(rawResult.result_list, isCrate, rootPath);

        }
    }
    return []
}

