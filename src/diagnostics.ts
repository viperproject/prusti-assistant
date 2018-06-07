'use strict';

import * as util from './util';
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
        if (!line || seen.has(line)) {
            continue;
        }
        seen.add(line);

        // Parse the message into a diagnostic.
        let diag: MessageDiagnostic = JSON.parse(line);
        if (diag.message !== undefined) {
            messages.push(diag.message);
        }
    }
    return messages;
}

/**
 * Parses a message into diagnostics.
 * 
 * @param bucket The array to store parsed diagnostics in.
 * @param msg The message to parse.
 * @param rootPath The root path of the rust project the message was generated
 * for.
 */
function parseMessage(bucket: Array<Diagnostic>, msg: Message, rootPath: string) {
    // Parse all valid spans.
    for (const span of msg.spans) {
        let level = parseMessageLevel(msg.level);
        if (!span.is_primary) {
            level = vscode.DiagnosticSeverity.Information;
        }

        let message = msg.message;
        if (msg.code) {
            message = `[${msg.code.code}] ${message}.`;
        }
        if (span.label) {
            message = `${message} \n[Note] ${span.label}`;
        }

        let range = parseSpanRange(span);
        let diagnostic = new vscode.Diagnostic(
            range,
            message,
            level
        );

        let file_path = path.join(rootPath, span.file_name);
        bucket.push({ file_path: file_path, diagnostic: diagnostic });
    }

    // Recursively parse child messages.
    for (const child of msg.children) {
        parseMessage(bucket, child, rootPath);
    }
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
    const output = await util.spawn('cargo', ['check', '--all-targets', '--message-format=json'], { cwd: rootPath });
    let diagnostics: Array<Diagnostic> = [];
    for (const messages of parseStdout(output.stdout)) {
        parseMessage(diagnostics, messages, rootPath);
    }
    return diagnostics;
}

// ========================================================
// Diagnostic Management
// ========================================================

export async function hasPrerequisites(): Promise<boolean> {
    try {
        await util.spawn('cargo', [`--version`]);
        return true;
    } catch (error) {
        return false;
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
        vscode.window.setStatusBarMessage('Running cargo check...');
        this.pending.clear();
        for (const project of this.projectList.projects) {
            this.addAll(await queryDiagnostics(project.path));
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
        let set = this.pending.get(diagnostic.file_path);
        if (set !== undefined) {
            set.push(diagnostic.diagnostic);
        } else {
            this.pending.set(diagnostic.file_path, [diagnostic.diagnostic]);
        }
    }
}
