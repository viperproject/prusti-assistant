import * as util from "./../util";
import * as vscode from "vscode";
import { Span, parseSpanRange } from "./../diagnostics";

// Additional Schemas for Custom information for IDE:
export interface CompilerInfoRaw {
    procedure_defs: ProcDefRaw[]
    function_calls: ProcDefRaw[]
    queried_source: string | null
}

interface ProcDefRaw {
    name: string,
    span: Span,
}

// In this schema we adjusted spans and
// also adjusted filepaths for crates
export interface CompilerInfo {
    procedure_defs: Map<string, ProcDef[]>,
    function_calls: Map<string, ProcDef[]>,
    queried_source: string | null,
}

export interface ProcDef {
    name: string,
    filename: string,
    range: vscode.Range,
}

function transformCompilerInfo(info: CompilerInfoRaw, root: string): CompilerInfo {
    const result: CompilerInfo = {
        procedure_defs: new Map(),
        function_calls: new Map(),
        queried_source: info.queried_source,
    };
    for (const proc of info.procedure_defs) {
        let filename = root + proc.span.file_name
        let entry : ProcDef = {
            name: proc.name,
            filename: filename, 
            range: parseSpanRange(proc.span),
        };
        let lookup = result.procedure_defs.get(filename);
        if (lookup !== undefined) {
            lookup.push(entry);
            util.log("pushed a new entry");
        } else {
            result.procedure_defs.set(filename, [entry]);
        }
        // {
        //     name: proc.name,
        //     filename: root + proc.span.file_name,
        //     range: parseSpanRange(proc.span),
        // });
    }
    for (const proc of info.function_calls) {
        let filename = root + proc.span.file_name;
        let entry: ProcDef = {
            name: proc.name,
            filename: filename,
            range: parseSpanRange(proc.span),
        };
        let lookup = result.function_calls.get(filename);
        if (lookup !== undefined) {
            lookup.push(entry);
            util.log("lookup with length: " + lookup.length);
        } else {
            result.function_calls.set(filename, [entry]);
        }
    }
    return result;
}

export function parseCompilerInfo(output: string, root: string): CompilerInfo | null {
    let result: CompilerInfoRaw;
    let token = "CompilerInfo ";
    let len = token.length;
    for (const line of output.split("\n")) {
        // to avoid unnecessary parsing of other json objects:
        if (!line.startsWith("CompilerInfo")) {
            continue;
        }

        // Parse the message into a diagnostic.
        result = JSON.parse(line.substring(len)) as CompilerInfoRaw;
        if (result.procedure_defs !== undefined) {
            util.log("Parsed raw IDE info. Found "
                + result.procedure_defs.length
                + " procedure defs and "
                + result.function_calls.length
                + " function calls.");
            util.log("The queried source had value: "
                + result.queried_source);
            return transformCompilerInfo(result, root);
        }
    }
    return null;
}




