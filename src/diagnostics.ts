'use strict';

import * as util from './util';
import * as config from './config';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

// ========================================================
// JSON Schemas
// ========================================================

interface CargoMessage {
    message: Message;
    target: Target;
}

interface Target {
    src_path: string;
}

interface Message {
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

interface Span {
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

// ========================================================
// Diagnostic Parsing
// ========================================================

interface Diagnostic {
    file_path: string;
    diagnostic: vscode.Diagnostic;
}

function parseMessageLevel(level: Level): vscode.DiagnosticSeverity {
    switch (level) {
        case Level.Error: return vscode.DiagnosticSeverity.Error;
        case Level.Note: return vscode.DiagnosticSeverity.Information;
        case Level.Help: return vscode.DiagnosticSeverity.Hint;
        case Level.Warning: return vscode.DiagnosticSeverity.Warning;
        case Level.Empty: return vscode.DiagnosticSeverity.Information;
        default: return vscode.DiagnosticSeverity.Error;
    }
}

function dummyRange(): vscode.Range {
    return new vscode.Range(0, 0, 0, 0);
}

function parseSpanRange(span: Span): vscode.Range {
    return new vscode.Range(
        span.line_start - 1,
        span.column_start - 1,
        span.line_end - 1,
        span.column_end - 1,
    );
}

function parseCargoOutput(output: string): Array<CargoMessage> {
    let messages: Array<CargoMessage> = [];
    let seen = new Set();
    for (const line of output.split("\n")) {
        if (line[0] !== "{") {
            continue;
        }
        seen.add(line);

        // Parse the message into a diagnostic.
        console.log("Parse JSON", line);
        let diag: CargoMessage = JSON.parse(line);
        console.log("Parsed JSON", diag);
        if (diag.message !== undefined) {
            messages.push(diag);
        }
    }
    return messages;
}

function parseRustcOutput(output: string): Array<Message> {
    let messages: Array<Message> = [];
    let seen = new Set();
    for (const line of output.split("\n")) {
        if (line[0] !== "{") {
            continue;
        }
        seen.add(line);

        // Parse the message into a diagnostic.
        console.log("Parse JSON", line);
        let diag: Message = JSON.parse(line);
        console.log("Parsed JSON", diag);
        if (diag.message !== undefined) {
            messages.push(diag);
        }
    }
    return messages;
}

function getCallSiteSpan(span: Span): Span {
    while (span.expansion) {
        span = span.expansion.span;
    }
    return span;
}

/**
 * Parses a message into diagnostics.
 * 
 * @param msg The message to parse.
 * @param rootPath The root path of the rust project the message was generated
 * for.
 */
function parseCargoMessage(msgDiag: CargoMessage, rootPath: string): Diagnostic {
    const mainFilePath = msgDiag.target.src_path;
    const msg = msgDiag.message;
    const level = parseMessageLevel(msg.level);

    // Parse primary span
    let primarySpan = undefined;
    for (const span of msg.spans) {
        if (span.is_primary) {
            primarySpan = span;
            break;
        }
    }
    if (primarySpan === undefined) {
        return {
            file_path: mainFilePath,
            diagnostic: new vscode.Diagnostic(
                dummyRange(),
                msg.message,
                level
            )
        };
    }

    let primaryMessage = msg.message;
    if (msg.code) {
        primaryMessage = `[${msg.code.code}] ${primaryMessage}.`;
    }
    if (primarySpan.label) {
        primaryMessage = `${primaryMessage} \n[Note] ${primarySpan.label}`;
    }
    let primaryCallSiteSpan = getCallSiteSpan(primarySpan);
    const primaryRange = parseSpanRange(primaryCallSiteSpan);
    const primaryFilePath = path.join(rootPath, primaryCallSiteSpan.file_name);

    let diagnostic = new vscode.Diagnostic(
        primaryRange,
        primaryMessage,
        level
    );

    // Parse all non-primary spans
    let relatedInformation = [];
    for (const span of msg.spans) {
        if (span.is_primary) {
            continue;
        }

        let message = "";
        if (span.label) {
            message = `[Note] ${span.label}`;
        }
        let callSiteSpan = getCallSiteSpan(span);
        const range = parseSpanRange(callSiteSpan);
        const filePath = path.join(rootPath, callSiteSpan.file_name);
        const fileUri = vscode.Uri.file(filePath);

        relatedInformation.push(
            new vscode.DiagnosticRelatedInformation(
                new vscode.Location(fileUri, range),
                message
            )
        );
    }

    // Recursively parse child messages.
    for (const child of msg.children) {
        const childMsgDiag = { target: msgDiag.target, message: child };
        const { file_path, diagnostic } = parseCargoMessage(childMsgDiag, rootPath);
        const fileUri = vscode.Uri.file(file_path);

        relatedInformation.push(
            new vscode.DiagnosticRelatedInformation(
                new vscode.Location(
                    fileUri,
                    diagnostic.range
                ),
                diagnostic.message
            )
        );
    }

    // Set related information
    diagnostic.relatedInformation = relatedInformation;

    return {
        file_path: primaryFilePath,
        diagnostic: diagnostic
    };
}

/**
 * Parses a message into diagnostics.
 * 
 * @param msg The message to parse.
 * @param rootPath The root path of the rust project the message was generated
 * for.
 */
function parseRustcMessage(msg: Message, mainFilePath: string): Diagnostic {
    const level = parseMessageLevel(msg.level);

    // Parse primary span
    let primarySpan = undefined;
    for (const span of msg.spans) {
        if (span.is_primary) {
            primarySpan = span;
            break;
        }
    }
    if (primarySpan === undefined) {
        return {
            file_path: mainFilePath,
            diagnostic: new vscode.Diagnostic(
                dummyRange(),
                msg.message,
                level
            )
        };
    }

    let primaryMessage = msg.message;
    if (msg.code) {
        primaryMessage = `[${msg.code.code}] ${primaryMessage}.`;
    }
    if (primarySpan.label) {
        primaryMessage = `${primaryMessage} \n[Note] ${primarySpan.label}`;
    }
    let primaryCallSiteSpan = getCallSiteSpan(primarySpan);
    const primaryRange = parseSpanRange(primaryCallSiteSpan);
    const primaryFilePath = primaryCallSiteSpan.file_name;

    let diagnostic = new vscode.Diagnostic(
        primaryRange,
        primaryMessage,
        level
    );

    // Parse all non-primary spans
    let relatedInformation = [];
    for (const span of msg.spans) {
        if (span.is_primary) {
            continue;
        }

        let message = "[Note] related expression";
        if (span.label) {
            message = `[Note] ${span.label}`;
        }
        let callSiteSpan = getCallSiteSpan(span);
        const range = parseSpanRange(callSiteSpan);
        const filePath = callSiteSpan.file_name;
        const fileUri = vscode.Uri.file(filePath);

        relatedInformation.push(
            new vscode.DiagnosticRelatedInformation(
                new vscode.Location(fileUri, range),
                message
            )
        );
    }

    // Recursively parse child messages.
    for (const child of msg.children) {
        const { file_path, diagnostic } = parseRustcMessage(child, mainFilePath);
        const fileUri = vscode.Uri.file(file_path);
        relatedInformation.push(
            new vscode.DiagnosticRelatedInformation(
                new vscode.Location(
                    fileUri,
                    diagnostic.range
                ),
                diagnostic.message
            )
        );
    }

    // Set related information
    diagnostic.relatedInformation = relatedInformation;

    return {
        file_path: primaryFilePath,
        diagnostic: diagnostic
    };
}

/**
 * Removes rust's metadata in the specified project folder. This is a work
 * around for `cargo check` not reissuing warning information for libs.
 * 
 * @param rootPath The root path of a rust project.
 */
async function removeDiagnosticMetadata(rootPath: string) {
    let pattern = new vscode.RelativePattern(path.join(rootPath, 'target', 'debug'), '*.rmeta');
    let files = (await vscode.workspace.findFiles(pattern));
    for (const file of files) {
        await fs.unlink(file.fsPath, error => {
            if (error !== null) {
                console.warn('Unlink failed', error);
            }
        });
    }
}

enum VerificationStatus {
    Crash,
    Verified,
    Errors
}

/**
 * Queries for the diagnostics of a rust project using cargo-prusti.
 * 
 * @param rootPath The root path of a rust project.
 * @returns An array of diagnostics for the given rust project.
 */
async function queryCrateDiagnostics(rootPath: string): Promise<[Array<Diagnostic>, VerificationStatus]> {
    // FIXME: Workaround for warning generation for libs.
    await removeDiagnosticMetadata(rootPath);
    const cargoPrustiPath = path.join(config.prustiHome(), "cargo-prusti");
    const output = await util.spawn(
        cargoPrustiPath,
        ["--message-format=json"],
        {
            cwd: rootPath,
            env: {
                RUST_BACKTRACE: "1",
                JAVA_HOME: config.javaHome(),
                VIPER_HOME: config.viperHome(),
                Z3_EXE: config.z3Exe(),
                BOOGIE_EXE: config.boogieExe(),
                PATH: process.env.PATH
            }
        }
    );
    let status = VerificationStatus.Errors;
    if (output.code === 0) {
        status = VerificationStatus.Verified;
    }
    if (output.stderr.match(/error: internal compiler error/)) {
        status = VerificationStatus.Crash;
    }
    let diagnostics: Array<Diagnostic> = [];
    for (const messages of parseCargoOutput(output.stdout)) {
        diagnostics.push(
            parseCargoMessage(messages, rootPath)
        );
    }
    return [diagnostics, status];
}

/**
 * Queries for the diagnostics of a rust program using prusti-rustc.
 * 
 * @param programPath The root path of a rust program.
 * @returns An array of diagnostics for the given rust project.
 */
async function queryProgramDiagnostics(programPath: string): Promise<[Array<Diagnostic>, VerificationStatus]> {
    const prustiRustcPath = path.join(config.prustiHome(), "prusti-rustc");
    const output = await util.spawn(
        prustiRustcPath,
        ["--error-format=json", programPath],
        {
            cwd: path.dirname(programPath),
            env: {
                RUST_BACKTRACE: "1",
                JAVA_HOME: config.javaHome(),
                VIPER_HOME: config.viperHome(),
                Z3_EXE: config.z3Exe(),
                BOOGIE_EXE: config.boogieExe(),
                PATH: process.env.PATH
            }
        }
    );
    let status = VerificationStatus.Errors;
    if (output.code === 0) {
        status = VerificationStatus.Verified;
    }
    if (output.stderr.match(/error: internal compiler error/)) {
        status = VerificationStatus.Crash;
    }
    let diagnostics: Array<Diagnostic> = [];
    for (const messages of parseRustcOutput(output.stderr)) {
        diagnostics.push(
            parseRustcMessage(messages, programPath)
        );
    }
    return [diagnostics, status];
}

// ========================================================
// Diagnostic Management
// ========================================================

export class DiagnosticsSet {
    diagnostics: Map<string, vscode.Diagnostic[]>;
    
    constructor() {
        this.diagnostics = new Map();
    }

    /// Returns false if the diagnostic should be ignored
    private reportDiagnostic(diagnostic: Diagnostic): boolean {
        if (config.reportErrorsOnly()) {
            if (diagnostic.diagnostic.severity !== vscode.DiagnosticSeverity.Error) {
                console.log("Ignore non-error diagnostic", diagnostic);
                return false;
            }
            if (diagnostic.diagnostic.message.match(/^aborting due to ([0-9]+ |)previous error(s|)$/)) {
                console.log("Ignore non-error diagnostic", diagnostic);
                return false;
            }
        }
        return true;
    }

    public addAll(diagnostics: Array<Diagnostic>) {
        for (const diag of diagnostics) {
            this.add(diag);
        }
    }

    public add(diagnostic: Diagnostic) {
        if (this.reportDiagnostic(diagnostic)) {
            let set = this.diagnostics.get(diagnostic.file_path);
            if (set !== undefined) {
                set.push(diagnostic.diagnostic);
            } else {
                this.diagnostics.set(diagnostic.file_path, [diagnostic.diagnostic]);
            }
        } else {
            console.log("Hide diagnostics", diagnostic);
        }
    }

    public render(diagnosticsCollection: vscode.DiagnosticCollection) {
        for (let [path, fileDiagnostics] of this.diagnostics.entries()) {
            const uri = vscode.Uri.file(path);
            console.log("Render diagnostics", uri, fileDiagnostics);
            diagnosticsCollection.set(uri, fileDiagnostics);
        }
    }
}

export async function generatesCratesDiagnostics(projectList: util.ProjectList): Promise<DiagnosticsSet> {
    let resultDiagnostics = new DiagnosticsSet();

    for (const project of projectList.projects) {
        if (!project.path) {
            continue; // FIXME: why this?
        }
        try {
            let [diagnostics, status] = await queryCrateDiagnostics(project.path);
            resultDiagnostics.addAll(diagnostics);
            if (status === VerificationStatus.Crash) {
                resultDiagnostics.add({
                    file_path: path.join(project.path, "Cargo.toml"),
                    diagnostic: new vscode.Diagnostic(
                        dummyRange(),
                        "Unexpected error: Prusti or the Rust compiler crashed. See the log and other reported errors for more details.",
                        vscode.DiagnosticSeverity.Error
                    )
                });
            }
        } catch (err) {
            console.error(err);
            util.log(`Error: ${err}`);
            const errorMessage = err.message || err.toString();
            resultDiagnostics.add({
                file_path: path.join(project.path, "Cargo.toml"),
                diagnostic: new vscode.Diagnostic(
                    dummyRange(),
                    `Unexpected error. ${errorMessage}. See the log for more details.`,
                    vscode.DiagnosticSeverity.Error
                )
            });
        }
    }

    return resultDiagnostics;
}


export async function generatesProgramDiagnostics(programPath: string): Promise<DiagnosticsSet> {
    let resultDiagnostics = new DiagnosticsSet();

    try {
        let [diagnostics, status] = await queryProgramDiagnostics(programPath);
        resultDiagnostics.addAll(diagnostics);
        if (status === VerificationStatus.Crash) {
            resultDiagnostics.add({
                file_path: programPath,
                diagnostic: new vscode.Diagnostic(
                    dummyRange(),
                    "Unexpected error: Prusti or the Rust compiler crashed. See the log and other reported errors for more details.",
                    vscode.DiagnosticSeverity.Error
                )
            });
        }
    } catch (err) {
        console.error(err);
        util.log(`Error: ${err}`);
        const errorMessage = err.message || err.toString();
        resultDiagnostics.add({
            file_path: programPath,
            diagnostic: new vscode.Diagnostic(
                dummyRange(),
                `Unexpected error: ${errorMessage}. See the log for more details.`,
                vscode.DiagnosticSeverity.Error
            )
        });
    }

    return resultDiagnostics;
}
