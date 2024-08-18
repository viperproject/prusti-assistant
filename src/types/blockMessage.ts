import * as vscode from "vscode";
import { Message, parseSpanRange } from "./message";
import * as util from "../util";

interface BlockResultRaw {
    method: string,
    path_id: number,
    // blockReachedMessages don't carry results
    // but they will be interpreted as success (true)
    result?: string,
}

export interface BlockResult {
    method: string,
    pathId: number,
    range: vscode.Range,
    file: string,
    result: boolean,
    pathProcessesd: boolean,
}

/** Parses both blockReachedMessage and pathProcessedMessage. blockReachedMessage results are considered a success. */
export function parseBlockMessage(msg: Message, token: string) : BlockResult | undefined {
    if (!msg.message.startsWith(token)) {
        util.log(`ERROR: block message did not start with ${token}.`);
        return undefined;
    }
    
    const rawResult = JSON.parse(msg.message.substring(token.length)) as BlockResultRaw;
    if (rawResult.method === undefined || rawResult.path_id === undefined){
        util.log("ERROR: could not parse method name or path id.");
        return undefined;
    }

    if (msg.spans.length !== 1) {
        util.log("ERROR: multiple spans or no spans for a block message.");
        return undefined
    }
    
    const span = msg.spans[0]
    // TODO should unreachable results be treated as success? they should never cause errors
    const boolResult = rawResult.result === undefined || rawResult.result === "Success" || rawResult.result === "Unreachable";
    const vscRange = parseSpanRange(span)

    return {
        "method": rawResult.method,
        "pathId": rawResult.path_id,
        "range": vscRange,
        "file": span.file_name,
        "result": boolResult,
        "pathProcessesd": token === "pathProcessedMessage"
    } as BlockResult;
}