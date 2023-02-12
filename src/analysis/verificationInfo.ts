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
    fileName: string,
    success: boolean,
    time_ms: number,
    cached: boolean,
}

export type VerificationInfo = VerificationResult[] 

// currently the value given for itemName is "filename_methodpath"
// should this be done in rust?
function splitName(name: string) : [string, string] {
    // position of the underscore
    let position = name.search(".rs_") + 3; 
    let filename = name.substring(0, position);
    let methodPath = name.substring(position+1);
    return [filename, methodPath]
}

function transformVerificationResult(rawResults: VerificationResultRaw[], isCrate: boolean, rootPath: string) : VerificationInfo {
    let dirPath: string; 
    if (isCrate) {
        dirPath = rootPath;
    } else {
        dirPath = path.dirname(rootPath) + "/";
    }

    let results: VerificationInfo = [];
    rawResults.forEach((rawRes) => {
        let [fileName, methodPath] = splitName(rawRes.item_name);
        let res = {
            methodName: methodPath,
            fileName: dirPath + fileName,
            success: rawRes.success,
            time_ms: rawRes.time_ms,
            cached: rawRes.cached,
            
        };
        results.push(res);
    });
    return results;
}

export function parseVerificationInfo(output: string, isCrate: boolean, rootPath: string): VerificationInfo {
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

