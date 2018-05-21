'use strict';

import * as util from './util';
import * as vscode from 'vscode';
import * as path from 'path';

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

function parseStdout(stdout: string): Array<MessageDiagnostic> {
    let messages: Array<MessageDiagnostic> = [];
    let seen = new Set();
    stdout.split("\n").forEach((line) => {
        // Remove duplicate lines.
        if (!line || seen.has(line)) {
            return;
        }
        seen.add(line);

        // Parse the message into a diagnostic.
        let diag: MessageDiagnostic = JSON.parse(line);
        if (diag.message !== undefined) {
            messages.push(diag);
        }
    });
    return messages;
}

function parseMessage(msg: Message, root_path: string): Array<Diagnostic> {
    let diagnostics: Array<Diagnostic> = [];

    // Parse all valid spans.
    msg.spans.forEach(span => {
        let level = parseMessageLevel(msg.level);
        if (!span.is_primary) {
            level = vscode.DiagnosticSeverity.Information;
        }

        let message = '';
        if (span.label) {
            message += `${span.label} \n\nCaused by: `;
        }
        message += `${msg.message}.`;

        let range = parseSpanRange(span);
        let diagnostic = new vscode.Diagnostic(
            range,
            message,
            level
        );

        let file_path = path.join(root_path, span.file_name);
        diagnostics.push({ file_path: file_path, diagnostic: diagnostic });
    });

    // Recursively parse child messages. 
    msg.children.forEach(child => {
        diagnostics.concat(parseMessage(child, root_path));
    });

    return diagnostics;
}

// ========================================================
// Diagnostic Management
// ========================================================

export class DiagnosticsManager {
    private pending: Map<string, vscode.Diagnostic[]> = new Map();
    private rootPaths: Array<string>;
    private target: vscode.DiagnosticCollection;

    public constructor(rootPaths: Array<string>, target: vscode.DiagnosticCollection) {
        this.rootPaths = rootPaths;
        this.target = target;
    }

    private async populateRoot(rootPath: string) {
        const output = await util.spawn('cargo', ['check', '--all-targets', '--message-format=json'], { cwd: rootPath });
        parseStdout(output.stdout).forEach(msg => {
            parseMessage(msg.message, rootPath).forEach(diag => {
                this.add(diag);
            });
        });
    }

    private async populateAll() {
        for (let rootPath of this.rootPaths) {
            await this.populateRoot(rootPath);
        }
    }

    public async refreshAll() {
        vscode.window.setStatusBarMessage('Running cargo check...');
        this.pending.clear();
        this.target.clear();
        await this.populateAll();
        this.render();
        vscode.window.setStatusBarMessage('');
    }

    private render() {
        for (let [path, file_diagnostic] of this.pending.entries()) {
            const uri = vscode.Uri.file(path);
            this.target.set(uri, file_diagnostic);
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
