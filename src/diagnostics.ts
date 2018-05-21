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
// Process Handling
// ========================================================

export function refreshDiagnostics(rust_diagnostics: vscode.DiagnosticCollection) {
    console.log(`Gathering diagnostics for ${vscode.workspace.rootPath}.`);
    vscode.window.setStatusBarMessage('Running cargo check...');

    const seen = new Set();
    const parser = new DiagnosticParser();
    const child = child_process.spawn('cargo', ['check', '--all-targets', '--message-format=json'], {
        cwd: vscode.workspace.rootPath
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
            parser.parseMessage((<MessageDiagnostic>diag).message);
        }
    });

    child.on('exit', function (code, signal) {
        parser.render(rust_diagnostics);
        vscode.window.setStatusBarMessage('');
    });
}

// ========================================================
// Diagnostic Parsing
// ========================================================

class DiagnosticParser {
    diagnostics: Map<string, vscode.Diagnostic[]> = new Map();

    public static parseMessageLevel(level: Level): vscode.DiagnosticSeverity {
        switch (level) {
            case Level.Error: return vscode.DiagnosticSeverity.Error;
            case Level.Note: return vscode.DiagnosticSeverity.Information;
            case Level.Help: return vscode.DiagnosticSeverity.Hint;
            case Level.Warning: return vscode.DiagnosticSeverity.Warning;
            default: return vscode.DiagnosticSeverity.Error;
        }
    }

    public parseMessage(msg: Message) {
        // Parse all valid spans.
        msg.spans.forEach(span => {
            let level = DiagnosticParser.parseMessageLevel(msg.level);
            if (!span.is_primary) {
                level = vscode.DiagnosticSeverity.Information;
            }

            let message = '';
            if (span.label) {
                message += `${span.label}.\n\nCaused by: `;
            }
            message += `${msg.message}.`;

            let range = new vscode.Range(
                span.line_start - 1,
                span.column_start - 1,
                span.line_end - 1,
                span.column_end - 1,
            );

            let diagnostic = new vscode.Diagnostic(
                range,
                message,
                level
            );

            // console.log(`Added: ${message}`);
            // console.log(msg);
            let file = path.join(vscode.workspace.rootPath || '', span.file_name);
            this.add(file, diagnostic);
        });

        // Recursively parse child messages. 
        msg.children.forEach(child => {
            this.parseMessage(child);
        });
    }

    public render(rust_diagnostics: vscode.DiagnosticCollection) {
        rust_diagnostics.clear();
        for (let [path, file_diagnostic] of this.diagnostics.entries()) {
            const uri = vscode.Uri.file(path);
            rust_diagnostics.set(uri, file_diagnostic);
        }
        this.diagnostics.clear();
    }

    private add(path: string, diagnostic: vscode.Diagnostic) {
        let set = this.diagnostics.get(path);
        if (set !== undefined) {
            if (set.indexOf(diagnostic) === -1) {
                set.push(diagnostic);
            }
        } else {
            this.diagnostics.set(path, [diagnostic]);
        }
    }
}
