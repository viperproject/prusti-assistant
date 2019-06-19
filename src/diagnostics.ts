'use strict';

import * as util from './util';
import * as config from './config';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

// ========================================================
// JSON Schemas
// ========================================================

interface MessageDiagnostic {
    message: Message;
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
}

interface Span {
    column_end: number;
    column_start: number;
    file_name: string;
    is_primary: boolean;
    label: string | null;
    line_end: number;
    line_start: number;
    expansion: Span | null;
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

function parseStdout(stdout: string): Array<Message> {
    let messages: Array<Message> = [];
    let seen = new Set();
    for (const line of stdout.split("\n")) {
        // Remove duplicate lines. Running '--all-targets' can generate
        // duplicate errors.
        //if (!line || seen.has(line)) {
        //    continue;
        //}
        seen.add(line);

        // Parse the message into a diagnostic.
        console.log("Parse JSON", line);
        let diag: MessageDiagnostic = JSON.parse(line);
        if (diag.message !== undefined) {
            messages.push(diag.message);
        }
    }
    return messages;
}

function getCallSiteSpan(span: Span): Span {
    while (span.expansion) {
        span = span.expansion;
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
function parseMessage(msg: Message, rootPath: string): Diagnostic {
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
            file_path: "",
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
        const { file_path, diagnostic } = parseMessage(child, rootPath);
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

/**
 * Queries for the diagnostics of a rust project.
 * 
 * @param rootPath The root path of a rust project.
 * @returns An array of diagnostics for the given rust project.
 */
async function queryDiagnostics(rootPath: string): Promise<Array<Diagnostic>> {
    // FIXME: Workaround for warning generation for libs.
    await removeDiagnosticMetadata(rootPath);
    const output = await util.spawn(config.cargoPrustiPath(), ['--message-format=json'], { cwd: rootPath });
    let diagnostics: Array<Diagnostic> = [];
    for (const messages of parseStdout(output.stdout)) {
        diagnostics.push(
            parseMessage(messages, rootPath)
        );
    }
    return diagnostics;
}

// ========================================================
// Diagnostic Management
// ========================================================

export function hasPrerequisites(): [boolean, null | string] {
    if (config.cargoPrustiPath() === "") {
        return [false, "Prusti's path is empty. Please fix the 'cargoPrustiPath' setting."];
    }
    try {
        const exists = fs.existsSync(config.cargoPrustiPath());
        if (!exists) {
            return [false, "Prusti's path does not point to a valid file. Please fix the 'cargoPrustiPath' setting."];
        }
    } catch (err) {
        console.error(err);
        util.getOutputChannel().appendLine(`Error: ${err}`);
        return [false, "Prusti's path looks wrong. Please check the 'cargoPrustiPath' setting."];
    }
    try {
        util.spawn(config.cargoPrustiPath(), [`--help`]);
        return [true, null];
    } catch (err) {
        console.error(err);
        util.getOutputChannel().appendLine(`Error: ${err}`);
        return [false, "Prusti's path looks wrong. Please check the 'cargoPrustiPath' setting."];
    }
}

export class DiagnosticsManager {
    private pending: Map<string, vscode.Diagnostic[]> = new Map();
    private projectList: util.ProjectList;
    private target: vscode.DiagnosticCollection;

    public constructor(projectList: util.ProjectList, target: vscode.DiagnosticCollection) {
        this.projectList = projectList;
        this.target = target;
    }

    public async refreshAll() {
        vscode.window.setStatusBarMessage('Running Prusti...');
        this.pending.clear();
        for (const project of this.projectList.projects) {
            try {
                this.addAll(await queryDiagnostics(project.path));
            } catch (err) {
                console.error(err);
                util.getOutputChannel().appendLine(`Error: ${err}`);
                this.add({
                    file_path: "",
                    diagnostic: new vscode.Diagnostic(
                        dummyRange(),
                        "Error in parsing Prusti's output. See the log for more details.",
                        vscode.DiagnosticSeverity.Error
                    )
                });
            }
        }
        this.render();
        vscode.window.setStatusBarMessage('');
    }

    private render() {
        this.target.clear();
        for (let [path, file_diagnostic] of this.pending.entries()) {
            const uri = vscode.Uri.file(path);
            this.target.set(uri, file_diagnostic);
        }
    }

    private addAll(diagnostic: Array<Diagnostic>) {
        for (const diag of diagnostic) {
            this.add(diag);
        }
    }

    private add(diagnostic: Diagnostic) {
        if (config.reportErrorsOnly()) {
            if (diagnostic.diagnostic.severity !== vscode.DiagnosticSeverity.Error) {
                console.log("Ignore non-error diagnostic", diagnostic);
                return;
            }
        }

        let set = this.pending.get(diagnostic.file_path);
        if (set !== undefined) {
            set.push(diagnostic.diagnostic);
        } else {
            let file_path = diagnostic.file_path;
            if (file_path === "") {
                // TODO: report the error on the main file of the project, not
                // on the active tab
                file_path = vscode.window.activeTextEditor.document.fileName;
            }
            this.pending.set(file_path, [diagnostic.diagnostic]);
        }
    }
}
