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

function parseMultiSpanRange(multiSpan: Span[]): vscode.Range {
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
    return finalRange || dummyRange();
}

function parseSpanRange(span: Span): vscode.Range {
    return new vscode.Range(
        span.line_start - 1,
        span.column_start - 1,
        span.line_end - 1,
        span.column_end - 1,
    );
}

function parseCargoOutput(output: string): CargoMessage[] {
    const messages: CargoMessage[] = [];
    const seen = new Set();
    for (const line of output.split("\n")) {
        if (line[0] !== "{") {
            continue;
        }
        seen.add(line);

        // Parse the message into a diagnostic.
        console.log("Parse JSON", line);
        const diag: CargoMessage = JSON.parse(line);
        console.log("Parsed JSON", diag);
        if (diag.message !== undefined) {
            messages.push(diag);
        }
    }
    return messages;
}

function parseRustcOutput(output: string): Message[] {
    const messages: Message[] = [];
    const seen = new Set();
    for (const line of output.split("\n")) {
        if (line[0] !== "{") {
            continue;
        }
        seen.add(line);

        // Parse the message into a diagnostic.
        console.log("Parse JSON", line);
        const diag: Message = JSON.parse(line);
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
    let primarySpan;
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
    const primaryCallSiteSpan = getCallSiteSpan(primarySpan);
    const primaryRange = parseSpanRange(primaryCallSiteSpan);
    const primaryFilePath = path.join(rootPath, primaryCallSiteSpan.file_name);

    const diagnostic = new vscode.Diagnostic(
        primaryRange,
        primaryMessage,
        level
    );

    // Parse all non-primary spans
    const relatedInformation = [];
    for (const span of msg.spans) {
        if (span.is_primary) {
            continue;
        }

        let message = "";
        if (span.label) {
            message = `[Note] ${span.label}`;
        }
        const callSiteSpan = getCallSiteSpan(span);
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
        diagnostic
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

    let primaryMessage = msg.message;
    if (msg.code) {
        primaryMessage = `[${msg.code.code}] ${primaryMessage}.`;
    }

    // Parse primary spans
    const primaryCallSiteSpans = [];
    for (const span of msg.spans) {
        if (!span.is_primary) {
            continue;
        }
        if (span.label) {
            primaryMessage = `${primaryMessage}\n[Note] ${span.label}`;
        }
        primaryCallSiteSpans.push(getCallSiteSpan(span));
    }
    if (primaryCallSiteSpans.length === 0) {
        return {
            file_path: mainFilePath,
            diagnostic: new vscode.Diagnostic(
                dummyRange(),
                msg.message,
                level
            )
        };
    }

    // Convert MultiSpans to Range and Diagnostic
    const primaryRange = parseMultiSpanRange(primaryCallSiteSpans);
    const primaryFilePath = primaryCallSiteSpans[0].file_name;
    const diagnostic = new vscode.Diagnostic(
        primaryRange,
        primaryMessage,
        level
    );

    // Parse all non-primary spans
    const relatedInformation = [];
    for (const span of msg.spans) {
        if (span.is_primary) {
            continue;
        }

        let message = "[Note] related expression";
        if (span.label) {
            message = `[Note] ${span.label}`;
        }
        const callSiteSpan = getCallSiteSpan(span);
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
        diagnostic
    };
}

/**
 * Removes rust's metadata in the specified project folder. This is a work
 * around for `cargo check` not reissuing warning information for libs.
 * 
 * @param rootPath The root path of a rust project.
 */
async function removeDiagnosticMetadata(rootPath: string) {
    const pattern = new vscode.RelativePattern(path.join(rootPath, 'target', 'debug'), '*.rmeta');
    const files = (await vscode.workspace.findFiles(pattern));
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
async function queryCrateDiagnostics(context: vscode.ExtensionContext, rootPath: string): Promise<[Diagnostic[], VerificationStatus]> {
    // FIXME: Workaround for warning generation for libs.
    await removeDiagnosticMetadata(rootPath);
    const output = await util.spawn(
        config.cargoPrustiExe(context),
        ["--message-format=json"],
        {
            cwd: rootPath,
            env: {
                RUST_BACKTRACE: "1",
                RUST_LOG: "info",
                JAVA_HOME: await config.javaHome(),
                VIPER_HOME: config.viperHome(context),
                Z3_EXE: config.z3Exe(context),
                BOOGIE_EXE: config.boogieExe(context),
                PATH: process.env.PATH  // Needed e.g. to run Rustup
            }
        }
    );
    let status = VerificationStatus.Crash;
    if (output.code === 0) {
        status = VerificationStatus.Verified;
    }
    // TODO: after upgrading the Rust compiler:
    // * exit code 1 --> error
    // * exit code 101 --> crash
    if (output.code === 101) {
        status = VerificationStatus.Errors;
    }
    if (output.stderr.match(/error: internal compiler error/)) {
        status = VerificationStatus.Crash;
    }
    if (output.stderr.match(/^thread '.*' panicked at/)) {
        status = VerificationStatus.Crash;
    }
    const diagnostics: Diagnostic[] = [];
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
async function queryProgramDiagnostics(context: vscode.ExtensionContext, programPath: string): Promise<[Diagnostic[], VerificationStatus]> {
    const output = await util.spawn(
        config.prustiRustcExe(context),
        ["--crate-type=lib", "--error-format=json", programPath],
        {
            cwd: path.dirname(programPath),
            env: {
                RUST_BACKTRACE: "1",
                RUST_LOG: "info",
                JAVA_HOME: await config.javaHome(),
                VIPER_HOME: config.viperHome(context),
                Z3_EXE: config.z3Exe(context),
                BOOGIE_EXE: config.boogieExe(context),
                PATH: process.env.PATH  // Needed e.g. to run Rustup
            }
        }
    );
    let status = VerificationStatus.Crash;
    if (output.code === 0) {
        status = VerificationStatus.Verified;
    }
    // TODO: after upgrading the Rust compiler:
    // * exit code 1 --> error
    // * exit code 101 --> crash
    if (output.code === 101) {
        status = VerificationStatus.Errors;
    }
    if (output.stderr.match(/error: internal compiler error/)) {
        status = VerificationStatus.Crash;
    }
    if (output.stderr.match(/^thread '.*' panicked at/)) {
        status = VerificationStatus.Crash;
    }
    const diagnostics: Diagnostic[] = [];
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
    private diagnostics: Map<string, vscode.Diagnostic[]>;
    
    constructor() {
        this.diagnostics = new Map();
    }

    public hasErrors(): boolean {
        let count = 0;
        this.diagnostics.forEach((value: vscode.Diagnostic[], _: string) => {
            value.forEach((value: vscode.Diagnostic) => {
                if (value.severity === vscode.DiagnosticSeverity.Error) {
                    count += 1;
                }
            });
        });
        return count > 0;
    }

    public hasWarnings(): boolean {
        let count = 0;
        this.diagnostics.forEach((value: vscode.Diagnostic[], _: string) => {
            value.forEach((value: vscode.Diagnostic) => {
                if (value.severity === vscode.DiagnosticSeverity.Warning) {
                    count += 1;
                }
            });
        });
        return count > 0;
    }

    public isEmpty(): boolean {
        return this.diagnostics.size === 0;
    }

    public countsBySeverity(): Map<vscode.DiagnosticSeverity, number> {
        const counts = new Map<vscode.DiagnosticSeverity, number>();
        this.diagnostics.forEach((diags, _) => {
            diags.forEach(diag => {
                counts.set(diag.severity, (counts.get(diag.severity) || 0) + 1);
            });
        });
        return counts;
    }

    public addAll(diagnostics: Diagnostic[]) {
        for (const diag of diagnostics) {
            this.add(diag);
        }
    }

    public add(diagnostic: Diagnostic) {
        if (this.reportDiagnostic(diagnostic)) {
            const set = this.diagnostics.get(diagnostic.file_path);
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
        diagnosticsCollection.clear();
        for (const [path, fileDiagnostics] of this.diagnostics.entries()) {
            const uri = vscode.Uri.file(path);
            console.log("Render diagnostics", uri, fileDiagnostics);
            diagnosticsCollection.set(uri, fileDiagnostics);
        }
    }

    /// Returns false if the diagnostic should be ignored
    private reportDiagnostic(diagnostic: Diagnostic): boolean {
        if (config.reportErrorsOnly()) {
            if (diagnostic.diagnostic.severity !== vscode.DiagnosticSeverity.Error && !diagnostic.diagnostic.message.match(/^\[Prusti\]/)) {
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
}

export async function generatesCratesDiagnostics(context: vscode.ExtensionContext, projectList: util.ProjectList): Promise<DiagnosticsSet> {
    const resultDiagnostics = new DiagnosticsSet();

    for (const project of projectList.projects) {
        if (!project.path) {
            continue; // FIXME: why this?
        }
        try {
            const [diagnostics, status] = await queryCrateDiagnostics(context, project.path);
            resultDiagnostics.addAll(diagnostics);
            if (status === VerificationStatus.Crash) {
                resultDiagnostics.add({
                    file_path: path.join(project.path, "Cargo.toml"),
                    diagnostic: new vscode.Diagnostic(
                        dummyRange(),
                        "Prusti encountered an error. See other reported errors and the log (View -> Output -> Prusti Assistant) for more details.",
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


export async function generatesProgramDiagnostics(context: vscode.ExtensionContext, programPath: string): Promise<DiagnosticsSet> {
    const resultDiagnostics = new DiagnosticsSet();

    try {
        const [diagnostics, status] = await queryProgramDiagnostics(context, programPath);
        resultDiagnostics.addAll(diagnostics);
        if (status === VerificationStatus.Crash) {
            resultDiagnostics.add({
                file_path: programPath,
                diagnostic: new vscode.Diagnostic(
                    dummyRange(),
                    "Prusti encountered an error. See other reported errors and the log (View -> Output -> Prusti Assistant) for more details.",
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
