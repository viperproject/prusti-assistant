import * as util from "./../util";
import * as path from "path";
import * as vscode from "vscode";
import { Span, parseSpanRange } from "./message";

/** the Rust types:
* has this nested type so we can pass it as json but also for possible
* extensions in the future
*/
interface EncodingInfoRaw {
    call_contract_spans: CallContractRaw[],
};

interface CallContractRaw {
    defpath: string, // defpath
    call_span: Span,
    contracts_spans: Span[],
};

/** The defpath and position of a function call and the ranges of all
* its contract-items that we can get(some are missing at the moment)
*/
export interface CallContract {
    name: string,
    callLocation: vscode.Location,
    contractLocations: vscode.Location[],
}

function transformEncodingInfo(info: EncodingInfoRaw, root: string, isCrate: boolean): CallContract[] {
    let results: CallContract[] = [];
    for (const cRaw of info.call_contract_spans) {
        let fileName = isCrate ? path.join(root, cRaw.call_span.file_name) : cRaw.call_span.file_name;
        let fileUri = vscode.Uri.file(fileName);
        util.log("added Encoding Info for file: " + fileName);
        let callRange = parseSpanRange(cRaw.call_span);
        let callLocation = new vscode.Location(fileUri, callRange);
        let contractLocations = [];
        for (const sp of cRaw.contracts_spans) {
            let range = parseSpanRange(sp);
            // let firstLineRange = util.FullLineRange(range);
            let fileUri = vscode.Uri.file(isCrate ? path.join(root, sp.file_name) : sp.file_name);
            contractLocations.push(new vscode.Location(fileUri, range));
        }
        results.push({
            name: cRaw.defpath,
            callLocation: callLocation,
            contractLocations: contractLocations,
        });
    }
    return results;
}


export function parseCallContracts(output: string, isCrate: boolean, root: string): CallContract[] | undefined {
    var result;
    const token = "encodingInfo";
    for (const line of output.split("\n")) {
        if (!line.startsWith(token)) {
            continue;
        }
        result = JSON.parse(line.substring(token.length)) as EncodingInfoRaw;
        if (result.call_contract_spans !== undefined) {
            return transformEncodingInfo(result, root, isCrate);
        }
    }
    return undefined;
}
