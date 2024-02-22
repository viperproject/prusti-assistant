import * as util from "./util";
import * as config from "./config";
import * as vscode from "vscode";
import * as path from "path";
import * as vvt from "vs-verification-toolbox";
import * as dependencies from "./dependencies";
import { queryCrateMetadata, CrateMetadataStatus } from "./crateMetadata";

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
    return finalRange ?? dummyRange();
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
    for (const line of output.split("\n")) {
        if (line[0] !== "{") {
            continue;
        }

        // Parse the message into a diagnostic.
        const diag = JSON.parse(line) as CargoMessage;
        if (diag.message !== undefined) {
            messages.push(diag);
        }
    }
    return messages;
}

function parseRustcOutput(output: string): Message[] {
    const messages: Message[] = [];
    for (const line of output.split("\n")) {
        if (line[0] !== "{") {
            continue;
        }

        // Parse the message into a diagnostic.
        const diag = JSON.parse(line) as Message;
        if (diag.message !== undefined) {
            messages.push(diag);
        }
    }
    return messages;
}

function getCallSiteSpan(span: Span): Span {
    while (span.expansion !== null) {
        span = span.expansion.span;
    }
    return span;
}

/**
 * Parses a message into a diagnostic.
 *
 * @param msgDiag The message to parse.
 * @param basePath The base path to resolve the relative paths in the diagnostics.
 * @param defaultRange The default range to use if no span is found in the message.
 * @returns The parsed diagnostic.
 */
function parseCargoMessage(msgDiag: CargoMessage, basePath: string, defaultRange?: vscode.Range): Diagnostic {
    const msg = msgDiag.message;
    const level = parseMessageLevel(msg.level);

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
    let primaryFilePath = msgDiag.target.src_path;
    let primaryRange = defaultRange ?? dummyRange();
    if (primaryCallSiteSpans.length > 0) {
        primaryRange = parseMultiSpanRange(primaryCallSiteSpans);
        primaryFilePath = primaryCallSiteSpans[0].file_name;
        if (!path.isAbsolute(primaryFilePath)) {
            primaryFilePath = path.join(basePath, primaryFilePath);
        }
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

        const message = `[Note] ${span.label ?? ""}`;
        const callSiteSpan = getCallSiteSpan(span);
        const range = parseSpanRange(callSiteSpan);
        const filePath = path.join(basePath, callSiteSpan.file_name);
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
        const childMsgDiag = {
            target: {
                src_path: primaryFilePath
            },
            message: child
        };
        const childDiagnostic = parseCargoMessage(childMsgDiag, basePath, primaryRange);
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

/**
 * Parses a message into diagnostics.
 *
 * @param msg The message to parse.
 * @param filePath The path of the file that was being compiled.
 */
function parseRustcMessage(msg: Message, filePath: string, defaultRange?: vscode.Range): Diagnostic {
    const level = parseMessageLevel(msg.level);

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
    let primaryFilePath = filePath;
    let primaryRange = defaultRange ?? dummyRange();
    if (primaryCallSiteSpans.length > 0) {
        primaryRange = parseMultiSpanRange(primaryCallSiteSpans);
        primaryFilePath = primaryCallSiteSpans[0].file_name;
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
        const childDiagnostic = parseRustcMessage(child, filePath, primaryRange);
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
        diagnostic
    };
}

/**
 * Removes Rust's metadata in the specified project folder. This is a work
 * around for `cargo check` not reissuing warning information for libs.
 *
 * @param targetPath The target path of a rust project.
 */
async function removeDiagnosticMetadata(targetPath: string) {
    const pattern = new vscode.RelativePattern(path.join(targetPath, "debug"), "*.rmeta");
    const files = await vscode.workspace.findFiles(pattern);
    const promises = files.map(file => {
        return (new vvt.Location(file.fsPath)).remove()
    });
    await Promise.all(promises)
}

enum VerificationStatus {
    Crash,
    Verified,
    Errors
}

/**
 * Queries for the diagnostics of a rust crate using cargo-prusti.
 *
 * @param prusti The location of Prusti files.
 * @param cratePath The path of a Rust crate.
 * @param destructors Where to store the destructors of the spawned processes.
 * @returns A tuple containing the diagnostics, status and duration of the verification.
 */
async function queryCrateDiagnostics(
    prusti: dependencies.PrustiLocation,
    cratePath: string,
    serverAddress: string,
    destructors: Set<util.KillFunction>,
): Promise<[Diagnostic[], VerificationStatus, util.Duration]> {
    const [metadata, metadataStatus, metadataDuration] = await queryCrateMetadata(prusti, cratePath, destructors);
    if (metadataStatus !== CrateMetadataStatus.Ok) {
        return [[], VerificationStatus.Crash, metadataDuration];
    }

    // FIXME: Workaround for warning generation for libs.
    await removeDiagnosticMetadata(metadata.target_directory);

    const cargoPrustiArgs = ["--message-format=json"].concat(
        config.extraCargoPrustiArgs()
    );
    const cargoPrustiEnv = {
        ...process.env,  // Needed to run Rustup
        ...{
            PRUSTI_SERVER_ADDRESS: serverAddress,
            PRUSTI_QUIET: "true",
            JAVA_HOME: (await config.javaHome())!.path,
        },
        ...config.extraPrustiEnv(),
    };
    const output = await util.spawn(
        prusti.cargoPrusti,
        cargoPrustiArgs,
        {
            options: {
                cwd: cratePath,
                env: cargoPrustiEnv,
            }
        },
        destructors,
    );
    let status = VerificationStatus.Crash;
    if (output.code === 0) {
        status = VerificationStatus.Verified;
    }
    if (output.code === 1) {
        status = VerificationStatus.Errors;
    }
    if (output.code === 101) {
        status = VerificationStatus.Errors;
    }
    if (/error: internal compiler error/.exec(output.stderr) !== null) {
        status = VerificationStatus.Crash;
    }
    if (/^thread '.*' panicked at/.exec(output.stderr) !== null) {
        status = VerificationStatus.Crash;
    }
    const basePath = metadata.workspace_root ?? cratePath;
    const diagnostics: Diagnostic[] = [];
    for (const messages of parseCargoOutput(output.stdout)) {
        diagnostics.push(
            parseCargoMessage(messages, basePath)
        );
    }
    return [diagnostics, status, output.duration];
}

/**
 * Queries for the diagnostics of a rust crate using prusti-rustc.
 *
 * @param prusti The location of Prusti files.
 * @param filePath The path of a Rust program.
 * @param destructors Where to store the destructors of the spawned processes.
 * @returns A tuple containing the diagnostics, status and duration of the verification.
 */
async function queryProgramDiagnostics(
    prusti: dependencies.PrustiLocation,
    filePath: string,
    serverAddress: string,
    destructors: Set<util.KillFunction>,
): Promise<[Diagnostic[], VerificationStatus, util.Duration]> {
    const prustiRustcArgs = [
        "--crate-type=lib",
        "--error-format=json",
        filePath
    ].concat(
        config.extraPrustiRustcArgs()
    );
    const prustiRustcEnv = {
        ...process.env,  // Needed to run Rustup
        ...{
            PRUSTI_SERVER_ADDRESS: serverAddress,
            PRUSTI_QUIET: "true",
            JAVA_HOME: (await config.javaHome())!.path,
        },
        ...config.extraPrustiEnv(),
    };
    const output = await util.spawn(
        prusti.prustiRustc,
        prustiRustcArgs,
        {
            options: {
                cwd: path.dirname(filePath),
                env: prustiRustcEnv,
            }
        },
        destructors
    );
    let status = VerificationStatus.Crash;
    if (output.code === 0) {
        status = VerificationStatus.Verified;
    }
    if (output.code === 1) {
        status = VerificationStatus.Errors;
    }
    if (output.code === 101) {
        status = VerificationStatus.Crash;
    }
    if (/error: internal compiler error/.exec(output.stderr) !== null) {
        status = VerificationStatus.Crash;
    }
    if (/^thread '.*' panicked at/.exec(output.stderr) !== null) {
        status = VerificationStatus.Crash;
    }
    const diagnostics: Diagnostic[] = [];
    for (const messages of parseRustcOutput(output.stderr)) {
        diagnostics.push(
            parseRustcMessage(messages, filePath)
        );
    }
    return [diagnostics, status, output.duration];
}

// ========================================================
// Diagnostic Management
// ========================================================

export class VerificationDiagnostics {
    private diagnostics: Map<string, vscode.Diagnostic[]>;

    constructor() {
        this.diagnostics = new Map<string, vscode.Diagnostic[]>();
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
        } else {
            util.log(`Ignored diagnostic message: '${diagnostic.diagnostic.message}'`);
        }
    }

    public renderIn(target: vscode.DiagnosticCollection): void {
        target.clear();
        for (const [filePath, fileDiagnostics] of this.diagnostics.entries()) {
            const uri = vscode.Uri.file(filePath);
            util.log(`Rendering ${fileDiagnostics.length} diagnostics at ${uri}`);
            target.set(uri, fileDiagnostics);
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
}

export enum VerificationTarget {
    StandaloneFile = "file",
    Crate = "crate"
}

export class DiagnosticsManager {
    private target: vscode.DiagnosticCollection;
    private procDestructors: Set<util.KillFunction> = new Set();
    private verificationStatus: vscode.StatusBarItem;
    private runCount = 0;

    public constructor(target: vscode.DiagnosticCollection, verificationStatus: vscode.StatusBarItem) {
        this.target = target;
        this.verificationStatus = verificationStatus;
    }

    public dispose(): void {
        util.log("Dispose DiagnosticsManager");
        this.killAll();
    }

    public inProgress(): number {
        return this.procDestructors.size
    }

    public killAll(): void {
        util.log(`Killing ${this.procDestructors.size} processes.`);
        this.procDestructors.forEach((kill) => kill());
    }

    public clearDiagnostics(uri?: vscode.Uri): void {
        if (uri) {
            util.log(`Clear diagnostics on ${uri}`);
            this.target.delete(uri);
        } else {
            util.log("Clear all diagnostics");
            this.target.clear();
        }
        this.verificationStatus.text = ""
        this.verificationStatus.tooltip = undefined;
        this.verificationStatus.command = undefined;
    }

    public async verify(prusti: dependencies.PrustiLocation, serverAddress: string, targetPath: string, target: VerificationTarget): Promise<void> {
        // Prepare verification
        this.runCount += 1;
        const currentRun = this.runCount;
        util.log(`Preparing verification run #${currentRun}.`);
        this.killAll();

        // Run verification
        const escapedFileName = path.basename(targetPath).replace("$", "\\$");
        this.verificationStatus.text = `$(sync~spin) Verifying ${target} '${escapedFileName}'...`;
        this.verificationStatus.tooltip = "Status of the Prusti verification. Click to stop Prusti.";
        this.verificationStatus.command = "prusti-assistant.killAll";

        const verificationDiagnostics = new VerificationDiagnostics();
        let durationSecMsg: string | null = null;
        const crashErrorMsg = "Prusti encountered an unexpected error. " +
            "If the issue persists, please open a [bug report](https://github.com/viperproject/prusti-dev/issues/new) or contact us on the [Zulip chat](https://prusti.zulipchat.com/). " +
            "See [the logs](command:prusti-assistant.openLogs) for more details.";
        let crashed = false;
        try {
            let diagnostics: Diagnostic[], status: VerificationStatus, duration: util.Duration;
            if (target === VerificationTarget.Crate) {
                [diagnostics, status, duration] = await queryCrateDiagnostics(prusti, targetPath, serverAddress, this.procDestructors);
            } else {
                [diagnostics, status, duration] = await queryProgramDiagnostics(prusti, targetPath, serverAddress, this.procDestructors);
            }

            verificationDiagnostics.addAll(diagnostics);
            durationSecMsg = (duration[0] + duration[1] / 1e9).toFixed(1);
            if (status === VerificationStatus.Crash) {
                crashed = true;
                util.log("Prusti encountered an unexpected error.");
                util.userError(crashErrorMsg);
            }
            if (status === VerificationStatus.Errors && !verificationDiagnostics.hasErrors()) {
                crashed = true;
                util.log("The verification failed, but there are no errors to report.");
                util.userError(crashErrorMsg);
            }
        } catch (err) {
            util.log(`Error while running Prusti: ${err}`);
            crashed = true;
            util.userError(crashErrorMsg);
        }

        if (currentRun != this.runCount) {
            util.log(`Discarding the result of the verification run #${currentRun}, because the latest is #${this.runCount}.`);
        } else {
            // Render diagnostics
            verificationDiagnostics.renderIn(this.target);
            if (crashed) {
                this.verificationStatus.text = `$(error) Verification of ${target} '${escapedFileName}' failed with an unexpected error`;
                this.verificationStatus.command = "prusti-assistant.openLogs";
            } else if (verificationDiagnostics.hasErrors()) {
                const counts = verificationDiagnostics.countsBySeverity();
                const errors = counts.get(vscode.DiagnosticSeverity.Error);
                const noun = errors === 1 ? "error" : "errors";
                this.verificationStatus.text = `$(error) Verification of ${target} '${escapedFileName}' failed with ${errors} ${noun} (${durationSecMsg} s)`;
                this.verificationStatus.command = "workbench.action.problems.focus";
            } else if (verificationDiagnostics.hasWarnings()) {
                const counts = verificationDiagnostics.countsBySeverity();
                const warnings = counts.get(vscode.DiagnosticSeverity.Warning);
                const noun = warnings === 1 ? "warning" : "warnings";
                this.verificationStatus.text = `$(warning) Verification of ${target} '${escapedFileName}' succeeded with ${warnings} ${noun} (${durationSecMsg} s)`;
                this.verificationStatus.command = "workbench.action.problems.focus";
            } else {
                this.verificationStatus.text = `$(check) Verification of ${target} '${escapedFileName}' succeeded (${durationSecMsg} s)`;
                this.verificationStatus.command = undefined;
            }
            this.verificationStatus.tooltip = "Status of the Prusti verification.";
        }
    }
}
