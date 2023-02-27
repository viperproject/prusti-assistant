import * as util from "./../util";
import * as vscode from "vscode";
import * as path from "path";
import { Span, parseSpanRange } from "./message";

// Additional Schemas for Custom information for IDE:
interface CompilerInfoRaw {
    procedure_defs: FunctionRefRaw[]
    function_calls: FunctionRefRaw[]
    queried_source: string | null
}

interface FunctionRefRaw {
    name: string,
    span: Span,
}

/** In this schema we replaced rust's spans with vscode's ranges
 * and also adjusted filepaths for crates, according to their rootPath
 */
export interface CompilerInfo {
    rootPath: string,
    procedureDefs: FunctionRef[],
    functionCalls: FunctionRef[],
    queriedSource: string | null,
    distinctFiles: Set<string>,
}

/**
 * can be both a function call or definition, which should be clear from the
 * data structure it's stored in
 */
export interface FunctionRef {
    identifier: string, // DefPath
    fileName: string, // complete path to the file containing this method
    range: vscode.Range,
}

/** Transform spans to ranges (rust repr. vs vscode representation) and
* adjust paths of spans (for crates they are relative to root folder)
*/
function transformCompilerInfo(info: CompilerInfoRaw, isCrate: boolean, root: string): CompilerInfo {
    const result: CompilerInfo = {
        rootPath: root,
        procedureDefs: [],
        functionCalls: [],
        queriedSource: info.queried_source,
        distinctFiles: new Set(),
    };
    for (const proc of info.procedure_defs) {
        var filename = isCrate ? path.join(root, proc.span.file_name) : proc.span.file_name;
        result.distinctFiles.add(filename);
        let entry : FunctionRef = {
            identifier: proc.name,
            fileName: filename,
            range: parseSpanRange(proc.span),
        };
        result.procedureDefs.push(entry);
    }

    for (const proc of info.function_calls) {
        let filename = isCrate ? path.join(root, proc.span.file_name) : proc.span.file_name;
        result.distinctFiles.add(filename);
        let entry: FunctionRef = {
            identifier: proc.name,
            fileName: filename,
            range: parseSpanRange(proc.span),
        };
        result.functionCalls.push(entry);
    }
    return result;
}

export function parseCompilerInfo(line: string, isCrate: boolean, root: string): CompilerInfo | undefined {
    let result: CompilerInfoRaw;
    let token = "compilerInfo";
    if (!line.startsWith(token)) {
        return undefined;
    }
    // Parse the message into a diagnostic.
    result = JSON.parse(line.substring(token.length)) as CompilerInfoRaw;
    if (result.procedure_defs !== undefined) {
        util.log("Parsed raw CompilerInfo. Found "
            + result.procedure_defs.length
            + " procedure defs and "
            + result.function_calls.length
            + " function calls.");
        return transformCompilerInfo(result, isCrate, root);
    }
    return undefined;
}
