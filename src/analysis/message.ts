import * as vscode from "vscode";
import { VerificationArgs } from "../verification"

export interface PrustiMessageConsumer extends vscode.Disposable {
    processMessage(msg: Message, vArgs: VerificationArgs): void,
    processCargoMessage(msg: CargoMessage, vArgs: VerificationArgs): void,
}

// ========================================================
// JSON Schemas
// ========================================================

export interface CargoMessage {
    message: Message;
    target: Target;
}

interface Target {
    src_path: string;
}

export interface Message {
    children: Message[];
    code: Code | null;
    level: Level;
    message: string;
    spans: Span[];
}

interface Code {
    code: string;
    explanation: string;
}

enum Level {
    Error = "error",
    Help = "help",
    Note = "note",
    Warning = "warning",
    Empty = "",
}

export interface Span {
    column_end: number;
    column_start: number;
    file_name: string;
    is_primary: boolean;
    label: string | null;
    line_end: number;
    line_start: number;
    expansion: Expansion | null;
}

interface Expansion {
    span: Span;
}

export function mapDiagnosticLevel(level: Level): vscode.DiagnosticSeverity {
    switch (level) {
        case Level.Error: return vscode.DiagnosticSeverity.Error;
        case Level.Note: return vscode.DiagnosticSeverity.Information;
        case Level.Help: return vscode.DiagnosticSeverity.Hint;
        case Level.Warning: return vscode.DiagnosticSeverity.Warning;
        case Level.Empty: return vscode.DiagnosticSeverity.Information;
        default: return vscode.DiagnosticSeverity.Error;
    }
}

export function dummyRange(): vscode.Range {
    return new vscode.Range(0, 0, 0, 0);
}

export function parseMultiSpanRange(multiSpan: Span[]): vscode.Range {
    let finalRange;
    for (const span of multiSpan) {
        const range = parseSpanRange(span);
        if (finalRange === undefined) {
            finalRange = range;
        } else {
            // Merge
            finalRange = finalRange.union(range);
        }
    }
    return finalRange ?? dummyRange();
}

export function parseSpanRange(span: Span): vscode.Range {
    let col_start = span.column_start - 1;
    if (span.column_start == 0) {
        col_start = 0;
    }
    return new vscode.Range(
        span.line_start - 1,
        col_start,
        span.line_end - 1,
        span.column_end - 1,
    );
}

export function getCallSiteSpan(span: Span): Span {
    while (span.expansion !== null) {
        span = span.expansion.span;
    }
    return span;
}


// we could implement some more thorough checking, but for now, this suffices
export function isCargoMessage(msg: Message|CargoMessage): msg is CargoMessage {
    return ((msg as CargoMessage).target !== undefined);
}

export function isValidCargoMessage(msg: CargoMessage): boolean {
    return (msg.message !== undefined && isValidRustcMessage(msg.message));
}

export function isValidRustcMessage(msg: Message) {
    // TODO: remove FakeError once fixed
    return (msg.message !== undefined && msg.message !== "[Prusti: FakeError]");
}

export function getCargoMessage(line: string): CargoMessage|undefined {
    if (line[0] != "{") {
        return undefined;
    }
    const msg = JSON.parse(line) as CargoMessage;
    if (!isValidCargoMessage(msg)) {
        return undefined;
    }
    return msg;
}

export function getRustcMessage(line: string): Message|undefined {
    if (line[0] != "{") {
        return undefined;
    }
    const msg = JSON.parse(line) as Message;
    if (!isValidRustcMessage(msg)) {
        return undefined;
    }
    return msg;
}

export function getMessage(line: string, isCargo: boolean): Message|undefined {
    if (isCargo) {
        const cargoMessage = getCargoMessage(line);
        if (cargoMessage !== undefined) {
            return cargoMessage.message;
        }
        return undefined;
    } else {
        const rustcMessage = getRustcMessage(line);
        return rustcMessage;
    }
}
