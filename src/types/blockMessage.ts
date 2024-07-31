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
    method: string, // TODO: should be consistent with pathKey(rootPath, methodName)
    pathId: number,
    range: vscode.Range,
    file: string,
    result: boolean,
    rangeId: string,
}

function getRangeId(file: string, range: vscode.Range): string {
  // only the line numbers matter for the gutter
  // different blocks mapping to the same (line) ranges should overwrite one-another
    return `${file}[${range.start.line},${range.end.line}]`;
  // return `${file}[${range.start.line},${range.start.character}][${range.end.line},${range.end.character}]`
}

/** Parses both blockReachedMessage and pathProcessedMessage. blockReachedMessage results are considered a success. */
export function parseBlockMessage(msg: Message, token: string) : BlockResult | undefined {
    if (!msg.message.startsWith(token)) {
        util.log(`ERROR: block message did not start with ${token}.`);
        return undefined;
    }
    
    // util.log(`\nprocessing block message: ${msg.message}`);
    const rawResult = JSON.parse(msg.message.substring(token.length)) as BlockResultRaw;
    if (rawResult.method === undefined || rawResult.path_id === undefined){
        util.log("ERROR: could not parse method name or path id.");
        return undefined;
    }

    if (msg.spans.length !== 1) {
        util.log("ERROR: multiple spans or no spans for a block message.");
        return undefined
    }
    
    // util.log(`processing spans: ${JSON.stringify(msg.spans)}`)
    const span = msg.spans[0]
    const boolResult = rawResult.result === undefined || rawResult.result === "Success";
    const vscRange = parseSpanRange(span)

    return {
        "method": rawResult.method,
        "pathId": rawResult.path_id,
        "range": vscRange,
        "file": span.file_name,
        "result": boolResult,
        "rangeId": getRangeId(span.file_name, vscRange),
    } as BlockResult;
}