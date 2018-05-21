'use strict';

import * as child_process from 'child_process';
import * as vscode from 'vscode';
import * as path from 'path';

// ========================================================
// JSON Schemas
// ========================================================

type Diagnostic = MessageDiagnostic | {};

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
// Diagnostic Handling
// ========================================================

export class DiagnosticsManager {
    private pending: Map<string, vscode.Diagnostic[]> = new Map();
    private root_path: string;
    private target: vscode.DiagnosticCollection;

    public constructor(root_path: string, target: vscode.DiagnosticCollection) {
        this.root_path = root_path;
        this.target = target;
    }

    private static parseMessageLevel(level: Level): vscode.DiagnosticSeverity {
        switch (level) {
            case Level.Error: return vscode.DiagnosticSeverity.Error;
            case Level.Note: return vscode.DiagnosticSeverity.Information;
            case Level.Help: return vscode.DiagnosticSeverity.Hint;
            case Level.Warning: return vscode.DiagnosticSeverity.Warning;
            default: return vscode.DiagnosticSeverity.Error;
        }
    }

    private static parseSpanRange(span: Span): vscode.Range {
        return new vscode.Range(
            span.line_start - 1,
            span.column_start - 1,
            span.line_end - 1,
            span.column_end - 1,
        );
    }

    public refreshDiagnostics() {
        vscode.window.setStatusBarMessage('Running cargo check...');

        const seen = new Set();
        const child = child_process.spawn('cargo', ['check', '--all-targets', '--message-format=json'], {
            cwd: this.root_path
        });

        child.stdout.on('data', (data) => {
            // Remove duplicate messages.
            let message = data.toString();
            if (seen.has(message)) {
                return;
            }
            seen.add(message);

            // Parse the message into a diagnostic.
            let diag: Diagnostic = JSON.parse(message);
            if ((<MessageDiagnostic>diag).message !== undefined) {
                this.parseMessage((<MessageDiagnostic>diag).message);
            }
        });

        child.on('exit', (code, signal) => {
            this.render();
            vscode.window.setStatusBarMessage('');
        });
    }

    private parseMessage(msg: Message) {
        // Parse all valid spans.
        msg.spans.forEach(span => {
            let level = DiagnosticsManager.parseMessageLevel(msg.level);
            if (!span.is_primary) {
                level = vscode.DiagnosticSeverity.Information;
            }

            let message = '';
            if (span.label) {
                message += `${span.label}.\n\nCaused by: `;
            }
            message += `${msg.message}.`;

            let range = DiagnosticsManager.parseSpanRange(span);
            let diagnostic = new vscode.Diagnostic(
                range,
                message,
                level
            );

            let file = path.join(this.root_path, span.file_name);
            this.add(file, diagnostic);
        });

        // Recursively parse child messages. 
        msg.children.forEach(child => {
            this.parseMessage(child);
        });
    }

    private render() {
        this.target.clear();
        for (let [path, file_diagnostic] of this.pending.entries()) {
            const uri = vscode.Uri.file(path);
            this.target.set(uri, file_diagnostic);
        }
        this.pending.clear();
    }

    private add(path: string, diagnostic: vscode.Diagnostic) {
        let set = this.pending.get(path);
        if (set !== undefined) {
            set.push(diagnostic);
        } else {
            this.pending.set(path, [diagnostic]);
        }
    }
}
