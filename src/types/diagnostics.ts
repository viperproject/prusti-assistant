import * as util from "../util";
import * as config from "../config";
import * as vscode from "vscode";
import * as path from "path";
import { PrustiMessageConsumer, Message, CargoMessage, isCargoMessage,
         parseSpanRange, parseMultiSpanRange,
         getCallSiteSpan, dummyRange, mapDiagnosticLevel } from "./message";
import { VerificationArgs } from "../verification"

// ========================================================
// Diagnostic Parsing
// ========================================================

interface Diagnostic {
    file_path: string;
    diagnostic: vscode.Diagnostic;
}

/**
 * Parses a message into a diagnostic.
 */
function parseDiagnostic(msg_raw: CargoMessage|Message, programPath: string, defaultRange?: vscode.Range): Diagnostic {
    let msg: Message;
    const isCargo: boolean = isCargoMessage(msg_raw);
    if (isCargo) {
        // this is a CargoMessage
        msg = (msg_raw as CargoMessage).message;
    } else {
        // this is a rustc message
        msg = (msg_raw as Message);
    }
    console.log(msg);
    const level = mapDiagnosticLevel(msg.level);


    // Read primary message
    let primaryMessage = msg.message;
    if (msg.code !== null) {
        primaryMessage = `[${msg.code.code}] ${primaryMessage}.`;
    }

    // Parse primary spans
    const primaryCallSiteSpans = [];
    for (const span of msg.spans) {
        if (!span.is_primary) {
            continue;
        }
        if (span.label !== null) {
            primaryMessage = `${primaryMessage}\n[Note] ${span.label}`;
        }
        primaryCallSiteSpans.push(getCallSiteSpan(span));
    }

    // Convert MultiSpans to Range and Diagnostic
    let primaryFilePath = isCargo ? (msg_raw as CargoMessage).target.src_path : programPath;
    let primaryRange = defaultRange ?? dummyRange();
    if (primaryCallSiteSpans.length > 0) {
        primaryRange = parseMultiSpanRange(primaryCallSiteSpans);
        primaryFilePath = isCargo ? path.join(programPath, primaryCallSiteSpans[0].file_name) : primaryCallSiteSpans[0].file_name;
    }
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

        const message = `[Note] ${span.label ?? "related expression"}`;
        const callSiteSpan = getCallSiteSpan(span);
        const range = parseSpanRange(callSiteSpan);
        const filePath = isCargo ? path.join(programPath, callSiteSpan.file_name) : callSiteSpan.file_name;
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
        const childMsgRaw: Message | CargoMessage = isCargo ? ({
            target: {
                src_path: primaryFilePath
            },
            message: child
        } as CargoMessage) : (child );
        const childDiagnostic = parseDiagnostic(childMsgRaw, programPath, primaryRange);
        const fileUri = vscode.Uri.file(childDiagnostic.file_path);
        relatedInformation.push(
            new vscode.DiagnosticRelatedInformation(
                new vscode.Location(
                    fileUri,
                    childDiagnostic.diagnostic.range
                ),
                childDiagnostic.diagnostic.message
            )
        );
    }


    // Set related information
    diagnostic.relatedInformation = relatedInformation;

    return {
        file_path: primaryFilePath,
        diagnostic: diagnostic,
    };
}

// ========================================================
// Diagnostic Management
// ========================================================

export class VerificationDiagnostics implements PrustiMessageConsumer {
    private diagnostics: Map<string, vscode.Diagnostic[]>;
    private diagnosticCollection: vscode.DiagnosticCollection;
    private changed = false;
    private intervalRegister: ReturnType<typeof setInterval>;

    constructor() {
        this.diagnostics = new Map<string, vscode.Diagnostic[]>();
        this.diagnosticCollection = vscode.languages.createDiagnosticCollection("prusti");
        this.intervalRegister = setInterval(() => {
            if (this.changed) {
                this.changed = false;
                this.renderIn();
            }
        }, 50);
    }

    public dispose(): void {
        clearInterval(this.intervalRegister);
        this.diagnosticCollection.dispose();
    }

    public reset(): void {
        util.log("Resetting verification diagnostics")
        this.diagnostics = new Map<string, vscode.Diagnostic[]>();
        this.diagnosticCollection.clear();
    }

    public hasErrors(): boolean {
        let count = 0;
        this.diagnostics.forEach((documentDiagnostics: vscode.Diagnostic[]) => {
            documentDiagnostics.forEach((diagnostic: vscode.Diagnostic) => {
                if (diagnostic.severity === vscode.DiagnosticSeverity.Error) {
                    count += 1;
                }
            });
        });
        return count > 0;
    }

    public hasWarnings(): boolean {
        let count = 0;
        this.diagnostics.forEach((documentDiagnostics: vscode.Diagnostic[]) => {
            documentDiagnostics.forEach((diagnostic: vscode.Diagnostic) => {
                if (diagnostic.severity === vscode.DiagnosticSeverity.Warning) {
                    count += 1;
                }
            });
        });
        return count > 0;
    }

    public countPrustiErrors(): number {
        let count = 0;
        this.diagnostics.forEach((documentDiagnostics: vscode.Diagnostic[]) => {
            documentDiagnostics.forEach((diagnostic: vscode.Diagnostic) => {
                if (diagnostic.severity === vscode.DiagnosticSeverity.Error && diagnostic.message.startsWith("[Prusti")) {
                    count += 1;
                }
            });
        });
        return count;
    }

    public isEmpty(): boolean {
        return this.diagnostics.size === 0;
    }

    public countsBySeverity(): Map<vscode.DiagnosticSeverity, number> {
        const counts = new Map<vscode.DiagnosticSeverity, number>();
        this.diagnostics.forEach((diags) => {
            diags.forEach(diag => {
                const count = counts.get(diag.severity);
                counts.set(diag.severity, (count === undefined ? 0 : count) + 1);
            });
        });
        return counts;
    }

    public addAll(diagnostics: Diagnostic[]): void {
        for (const diag of diagnostics) {
            this.add(diag);
        }
    }

    public add(diagnostic: Diagnostic): void {
        if (this.reportDiagnostic(diagnostic)) {
            const set = this.diagnostics.get(diagnostic.file_path);
            if (set !== undefined) {
                set.push(diagnostic.diagnostic);
            } else {
                this.diagnostics.set(diagnostic.file_path, [diagnostic.diagnostic]);
            }
            this.changed = true;
        } else {
            util.log(`Ignored diagnostic message: '${diagnostic.diagnostic.message}'`);
        }
    }

    public renderIn(): void {
        for (const [filePath, fileDiagnostics] of this.diagnostics.entries()) {
            const uri = vscode.Uri.file(filePath);
            util.log(`Rendering ${fileDiagnostics.length} diagnostics at ${uri}`);
            this.diagnosticCollection.set(uri, fileDiagnostics);
        }
    }

    /// Returns false if the diagnostic should be ignored
    private reportDiagnostic(diagnostic: Diagnostic): boolean {
        const message = diagnostic.diagnostic.message;
        if (config.reportErrorsOnly()) {
            if (diagnostic.diagnostic.severity !== vscode.DiagnosticSeverity.Error
                && message.indexOf("Prusti") === -1) {
                return false;
            }
        }
        if (/^aborting due to (\d+ |)previous error(s|)/.exec(message) !== null) {
            return false;
        }
        if (/^\d+ warning(s|) emitted/.exec(message) !== null) {
            return false;
        }
        return true;
    }

    public processMessage(msg: Message, vArgs: VerificationArgs): void {
        const diag = parseDiagnostic(msg, vArgs.targetPath);
        util.log("Consumed rustc message: " + msg.message);
        this.add(diag);
    }

    public processCargoMessage(msg: CargoMessage, vArgs: VerificationArgs): void {
        const diag = parseDiagnostic(msg, vArgs.targetPath);
        util.log("Consumed cargo message: " + msg.message.message);
        this.add(diag);
    }
}
