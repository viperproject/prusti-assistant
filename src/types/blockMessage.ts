import * as vscode from "vscode";

interface BlockResultRaw {
    method: string,
    pathId: number,
    span: string, // Span
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

function _getRangeId(file: string, range: vscode.Range): string {
  // only the line numbers matter for the gutter
  // different blocks mapping to the same (line) ranges should overwrite one-another
  return `${file}[${range.start.line},${range.end.line}]`
  // return `${file}[${range.start.line},${range.start.character}][${range.end.line},${range.end.character}]`
}

function transformRawResult(result: BlockResultRaw): BlockResult {
    // TODO: map range string from prusti to actual vscode range again.
    // if not in vscode range format yet, use message.ts::parse(Multi)SpanRange()
    const _boolResult = result.result === undefined || result.result === "Success";
    throw new Error("TODO: transform string representation of span from prusti to actual vscode range")
}

export function blockResultAnd(b1: BlockResult, b2: BlockResult) : BlockResult {
    if (b1.pathId === b2.pathId && b1.rangeId === b2.rangeId && b1.method === b2.method) {
      return {
        method: b1.method,
        pathId: b1.pathId,
        range: b1.range,
        file: b1.file,
        rangeId: b1.rangeId,
        result: b1.result && b2.result
      };
    } else {
      throw new Error("ERROR: pathId, rangeId or method of compared BlockResults did not match. Should never happen.")
    }
}

/** Parses both blockReachedMessage and pathProcessedMessage. blockReachedMessage results are considered a success. */
export function parseBlockMessage(msg: string, token: string) : BlockResult | undefined {
    if (!msg.startsWith(token)) {
        return undefined;
    }
    const rawResult = JSON.parse(msg.substring(token.length)) as BlockResultRaw;
    if (rawResult.method === undefined || rawResult.pathId === undefined || rawResult.span === undefined){
      return undefined;
    }
    return transformRawResult(rawResult);

}