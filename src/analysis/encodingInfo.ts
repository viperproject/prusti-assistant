import * as util from "./../util";
import * as vscode from "vscode";
import { Span, parseSpanRange } from "./../diagnostics";

// the Rust types
interface EncodingInfoRaw {
    call_contract_spans: CallContractRaw[], 
};

interface CallContractRaw {
    defpath: string, // defpath
    call_span: Span,
    contracts_spans: Span[],
};

export interface CallContracts {
    name: string,
    callLocation: vscode.Location,
    contractLocations: vscode.Location[], 
}

function transformEncodingInfo(info: EncodingInfoRaw, root: string, isCrate: boolean): CallContracts[] {
    let results: CallContracts[] = [];
    for (const cRaw of info.call_contract_spans) {
        let fileName = isCrate ? root + cRaw.call_span.file_name : cRaw.call_span.file_name;
        let fileUri = vscode.Uri.file(fileName);
        let callRange = parseSpanRange(cRaw.call_span);
        let callLocation = new vscode.Location(fileUri, callRange);
        let contractLocations = [];
        for (const sp of cRaw.contracts_spans) {
            let range = parseSpanRange(sp);
            let fileUri= vscode.Uri.file(isCrate ? root + sp.file_name : sp.file_name);
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


export function parseCallContracts(output: string, root: string, isCrate: boolean): CallContracts[] | null {
    var result;
    const token = "EncodingInfo ";
    for (const line of output.split("\n")) {
        if (!line.startsWith(token)) {
            continue;
        }
        result = JSON.parse(line.substring(token.length)) as EncodingInfoRaw;
        if (result.call_contract_spans !== undefined) {
            return transformEncodingInfo(result, root, isCrate);
        }
    }
    return null;
}
