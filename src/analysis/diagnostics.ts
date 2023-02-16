import * as util from "./util";
import * as config from "./config";
import * as vscode from "vscode";
import * as path from "path";
import * as vvt from "vs-verification-toolbox";
import * as dependencies from "./dependencies";
import { process_output } from "./analysis/processing"

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

function getCallSiteSpan(span: Span): Span {
    while (span.expansion !== null) {
        span = span.expansion.span;
    }
    return span;
}

/**
 * Parses a message into a diagnostic.
 *
 * @param msg The message to parse.
 * @param rootPath The root path of the rust project the message was generated
 * for.
 */
function parseCargoMessage(msgDiag: CargoMessage, rootPath: string, defaultRange?: vscode.Range): Diagnostic {
    const msg = msgDiag.message;
    console.log("PARSE CARGO MESSAGE");
    console.log(msg);
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
        primaryFilePath = path.join(rootPath, primaryCallSiteSpans[0].file_name);
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
        const childMsgDiag = {
            target: {
                src_path: primaryFilePath
            },
            message: child
        };
        const childDiagnostic = parseCargoMessage(childMsgDiag, rootPath, primaryRange);
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
 * @param rootPath The root path of the rust project the message was generated
 * for.
 */
function parseRustcMessage(msg: Message, mainFilePath: string, defaultRange?: vscode.Range): Diagnostic {
    console.log("PARSE RUSTC MESSAGE");
    console.log(msg);
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
    let primaryFilePath = mainFilePath;
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
        const childDiagnostic = parseRustcMessage(child, mainFilePath, primaryRange);
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
 * Removes rust's metadata in the specified project folder. This is a work
 * around for `cargo check` not reissuing warning information for libs.
 *
 * @param rootPath The root path of a rust project.
 */
async function removeDiagnosticMetadata(rootPath: string) {
    const pattern = new vscode.RelativePattern(path.join(rootPath, "target", "debug"), "*.rmeta");
    const files = await vscode.workspace.findFiles(pattern);
    const promises = files.map(file => {
        return (new vvt.Location(file.fsPath)).remove()
    });
    await Promise.all(promises)
}

enum VerificationStatus {
    Crash,
    Verified,
    Errors,
    SkippedVerification,
    Killed,
}

/**
 * Queries for the diagnostics of a rust project using cargo-prusti.
 *
 * @param rootPath The root path of a rust project.
 * @returns An array of diagnostics for the given rust project.
 */
async function queryCrateDiagnostics(
    prusti: dependencies.PrustiLocation,
    rootPath: string,
    serverAddress: string,
    destructors: Set<util.KillFunction>,
    skipVerify: boolean,
    selectiveVerify: string | undefined,
    verificationDiagnostics: VerificationDiagnostics,
    target: vscode.DiagnosticCollection,
    quantifierInstantiationsProvider: QuantifierInstantiationsProvider,
    quantifierChosenTriggersProvider: QuantifierChosenTriggersProvider,
): Promise<[VerificationStatus, util.Duration ]> {
    // FIXME: Workaround for warning generation for libs.
    if (!skipVerify) {
        await removeDiagnosticMetadata(rootPath);
    }
    const cargoPrustiArgs = ["--message-format=json"].concat(
        config.extraCargoPrustiArgs()
    );
    util.log("passed args:" + cargoPrustiArgs.toString());
    const cargoPrustiEnv = {
        ...process.env,  // Needed to run Rustup
        ...{
            PRUSTI_SERVER_ADDRESS: serverAddress,
            PRUSTI_SHOW_IDE_INFO: "true",
            PRUSTI_SKIP_VERIFICATION: skipVerify ? "true" : "false",
            PRUSTI_SELECTIVE_VERIFY: skipVerify ? undefined : selectiveVerify,
            PRUSTI_QUERY_METHOD_SIGNATURE: skipVerify ? selectiveVerify : undefined,
            PRUSTI_QUIET: "true",
            JAVA_HOME: (await config.javaHome())!.path,
        },
        ...config.extraPrustiEnv(),
    };
    var buffer = "";
    const output = await util.spawn(
        prusti.cargoPrusti,
        cargoPrustiArgs,
        {
            options: {
                cwd: rootPath,
                env: cargoPrustiEnv,
            },
            onStdout: data => {
                buffer = buffer.concat(data);
                const ind = buffer.lastIndexOf("\n");
                const parsable = buffer.substring(0, ind);
                buffer = buffer.substring(ind+1);
                for (const line of parsable.split("\n")) {
                    if (line[0] !== "{") {
                        continue;
                    }

                    // Parse the message into a diagnostic.
                    const diag = JSON.parse(line) as CargoMessage;
                    if (diag.message !== undefined && diag.message.message !== undefined) {
                        const qim_str = "quantifier_instantiations_message";
                        const qctm_str = "quantifier_chosen_triggers_message";
                        const ide_vr_str = "ide_verification_result";
                        if (diag.message.message === "[Prusti: FakeError]") {
                            // skip these errors! they just avoid the result being cached
                            // if it shouldn't (compiler cache, not prusti)
                            continue;
                        } else if (diag.message.message.startsWith(qim_str)) {
                            if (diag.message.spans.length !== 1) {
                                util.log("ERROR: multiple spans for a quantifier.");
                            }
                            const span = diag.message.spans[0];
                            const range = parseSpanRange(span);
                            const fileName = span.file_name;
                            const parsed_m = JSON.parse(diag.message.message.substring(qim_str.length));
                            const method = parsed_m["method"];
                            const instantiations = parsed_m["instantiations"];

                            quantifierInstantiationsProvider.update(fileName, method, instantiations, range);
                        } else if (diag.message.message.startsWith(qctm_str)) {
                            if (diag.message.spans.length !== 1) {
                                util.log("ERROR: multiple spans for a quantifier.");
                            }
                            const span = diag.message.spans[0];
                            const range = parseSpanRange(span);
                            const fileName = span.file_name;
                            const parsed_m = JSON.parse(diag.message.message.substring(qctm_str.length));
                            const viper_quant = parsed_m["viper_quant"];
                            const triggers = parsed_m["triggers"];
                            quantifierChosenTriggersProvider.update(fileName, viper_quant, triggers, range);
                        } else {
                            const msg = parseCargoMessage(diag, rootPath);
                            verificationDiagnostics.add_and_render(msg, target);
                        }
                    }
                }
            }
        },
        destructors,
    );
    let status = VerificationStatus.Crash;

    if (output.code === 0) {
        if (skipVerify) {
            status = VerificationStatus.SkippedVerification;
        } else {
            status = VerificationStatus.Verified;
        }
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
    // we were (probably?) killed by killAll -> not necessary to show that Prusti encountered an
    // unexpected error
    if (output.code === null && output.signal === "SIGKILL") {
      status = VerificationStatus.Killed;
    }

    util.log("Parsing IDE Info")
    process_output(rootPath + "/", output.stdout, true);

    return [status, output.duration];
}

/**
 * Queries for the diagnostics of a rust program using prusti-rustc.
 *
 * @param programPath The root path of a rust program.
 * @returns An array of diagnostics for the given rust project.
 */
async function queryProgramDiagnostics(
    prusti: dependencies.PrustiLocation,
    programPath: string,
    serverAddress: string,
    destructors: Set<util.KillFunction>,
    skipVerify: boolean,
    selectiveVerify: string | undefined,
    verificationDiagnostics: VerificationDiagnostics,
    target: vscode.DiagnosticCollection,
    quantifierInstantiationsProvider: QuantifierInstantiationsProvider,
    quantifierChosenTriggersProvider: QuantifierChosenTriggersProvider,
): Promise<[VerificationStatus, util.Duration]> {
    const prustiRustcArgs = [
        "--crate-type=lib",
        "--error-format=json",
        programPath
    ].concat(
        config.extraPrustiRustcArgs()
    );
    const prustiRustcEnv = {
        ...process.env,  // Needed to run Rustup
        ...{
            PRUSTI_SERVER_ADDRESS: serverAddress,
            PRUSTI_SHOW_IDE_INFO: "true",
            PRUSTI_SKIP_VERIFICATION: skipVerify ? "true" : "false",
            PRUSTI_SELECTIVE_VERIFY: selectiveVerify,
            PRUSTI_QUIET: "true",
            JAVA_HOME: (await config.javaHome())!.path,
        },
        ...config.extraPrustiEnv(),
    };
    var buffer = "";
    const output = await util.spawn(
        prusti.prustiRustc,
        prustiRustcArgs,
        {
            options: {
                cwd: path.dirname(programPath),
                env: prustiRustcEnv,
            },
            onStderr: data => {
                buffer = buffer.concat(data);
                const ind = buffer.lastIndexOf("\n");
                const parsable = buffer.substring(0, ind);
                buffer = buffer.substring(ind+1);
                for (const line of parsable.split("\n")) {
                    if (line[0] !== "{") {
                        continue;
                    }

                    // Parse the message into a diagnostic.
                    const diag = JSON.parse(line) as Message;
                    if (diag.message !== undefined) {
                        const qim_str = "quantifier_instantiations_message";
                        const qctm_str = "quantifier_chosen_triggers_message";
                        const ide_vr_str = "ide_verification_result";
                        // TODO: add case for CompilerInfo and IdeVerificationResult/VerificationInfo
                        if (diag.message === "[Prusti: FakeError]") {
                            // skip these errors! they just avoid the result being cached
                            // if it shouldn't (compiler cache, not prusti)
                            continue;
                        } else if (diag.message.startsWith(qim_str)) {
                            if (diag.spans.length !== 1) {
                                util.log("ERROR: multiple spans for a quantifier.");
                            }
                            const span = diag.spans[0];
                            const range = parseSpanRange(span);
                            const fileName = span.file_name;
                            const parsed_m = JSON.parse(diag.message.substring(qim_str.length));
                            const method = parsed_m["method"];
                            const instantiations = parsed_m["instantiations"];

                            quantifierInstantiationsProvider.update(fileName, method, instantiations, range);
                        } else if (diag.message.startsWith(qctm_str)) {
                            if (diag.spans.length !== 1) {
                                util.log("ERROR: multiple spans for a quantifier.");
                            }
                            const span = diag.spans[0];
                            const range = parseSpanRange(span);
                            const fileName = span.file_name;
                            const parsed_m = JSON.parse(diag.message.substring(qctm_str.length));
                            const viper_quant = parsed_m["viper_quant"];
                            const triggers = parsed_m["triggers"];
                            quantifierChosenTriggersProvider.update(fileName, viper_quant, triggers, range);
                        } else {
                            const msg = parseRustcMessage(diag, programPath);
                            verificationDiagnostics.add_and_render(msg, target);
                        }
                    }
                }
            }
        },
        destructors,
    );
    let status = VerificationStatus.Crash;
    const diagnostics: Diagnostic[] = [];
    if (output.code === 0) {
        if (skipVerify) {
            status = VerificationStatus.SkippedVerification
            // if we can't parse this field we still report a crash..
        } else {
            status = VerificationStatus.Verified;
        }
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
    // we were (probably?) killed by killAll -> not necessary to show that Prusti encountered an
    // unexpected error
    if (output.code === null && output.signal === "SIGKILL") {
      status = VerificationStatus.Killed;
    }

    // paths are already absolute
    process_output(programPath, output.stdout, false);

    return [status, output.duration];
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
        } else {
            util.log(`Ignored diagnostic message: '${diagnostic.diagnostic.message}'`);
        }
    }

    public add_and_render(diagnostic: Diagnostic, target: vscode.DiagnosticCollection): void {
        // TODO: somehow threshhold this
        if (this.reportDiagnostic(diagnostic)) {
            this.add(diagnostic);
            const filePath = diagnostic.file_path;
            const fileDiagnostics = this.diagnostics.get(filePath);
            const uri = vscode.Uri.file(filePath);
            //util.log(`Rendering new diagnostics at ${uri}`);
            target.set(uri, fileDiagnostics);
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

function strToRange(range_str: string): vscode.Range {
    const arr = JSON.parse(range_str) as vscode.Position[];
    return new vscode.Range(arr[0], arr[1]);
}

class QuantifierChosenTriggersProvider implements vscode.HoverProvider {
    // key1: fileName, key2: stringified range, value: [quantifier string, triggers string]
    private state_map: Map<string, Map<string, [string, string]>>;
    public constructor() {
        this.state_map = new Map<string, Map<string, [string, string]>>();
        vscode.languages.registerHoverProvider('rust', this);
    }

    private getHoverText(document: vscode.TextDocument, position: vscode.Position): string|undefined {
        const range_map = this.state_map.get(document.fileName);
        if (range_map === undefined) {
            return undefined;
        }
        const init_range = new vscode.Range(0, 0, 0, 0);
        // get the innermost range by iterating over all ranges.
        let matching_range: vscode.Range = Array.from(range_map.keys()).reduce((cur, range_str) => {
            const range = strToRange(range_str);
            if (range.contains(position) && (cur.contains(range) || cur.isEqual(init_range))) {
                return range;
            } else {
                return cur;
            }
        }, init_range);
        if (matching_range.isEqual(init_range)) {
            return undefined;
        }
        const range_str = JSON.stringify(matching_range);
        const [quantifier, triggers] = range_map.get(range_str)!;
        const text = `Viper quantifier: ${quantifier}\nViper triggers: ${triggers}`
        return text;
    }

    public provideHover(document: vscode.TextDocument, position: vscode.Position, _token: vscode.CancellationToken): vscode.Hover|undefined {
        const text = this.getHoverText(document, position);
        if (text === undefined) {
            return undefined;
        }
        return new vscode.Hover(text!);
    }

    public update(fileName: string, quantifier: string, triggers: string, range: vscode.Range): void {
        if (!this.state_map.has(fileName)) {
            const range_map = new Map<string, [string, string]>();
            this.state_map.set(fileName, range_map);
        }
        const str_range = JSON.stringify(range);
        const range_map = this.state_map.get(fileName)!;
        range_map.set(str_range, [quantifier, triggers]);
    }
}

class QuantifierInstantiationsProvider implements vscode.InlayHintsProvider, vscode.HoverProvider {
    // key1: fileName, key2: stringified range, key3: method, value: n_instantiations
    // note: we use the stringified range as identifier because Map uses strict equality "===" to
    // check for key equality, which does not work with newly constructed ranges.
    private state_map: Map<string, Map<string, Map<string, number>>>;
    // we cache the inlayHints for each file until we get a change
    private inlay_cache_map: Map<string, vscode.InlayHint[]>
    private inlay_register: vscode.Disposable;
    private changed: boolean = false;

    public constructor() {
        this.state_map = new Map<string, Map<string, Map<string, number>>>();
        this.inlay_cache_map = new Map<string, vscode.InlayHint[]>();
        vscode.languages.registerHoverProvider('rust', this);
        this.inlay_register = vscode.languages.registerInlayHintsProvider('rust', this);
        setInterval(() => this.reregisterInlayHintsProvider(), 1000);

    }

    private reregisterInlayHintsProvider(): void {
        if (this.changed) {
            this.inlay_register.dispose();
            this.inlay_register = vscode.languages.registerInlayHintsProvider('rust', this);
            util.log("Successfully reregistered InlayHintsProvider");
        }
    }

    public provideInlayHints(document: vscode.TextDocument, range: vscode.Range, _token: vscode.CancellationToken): vscode.InlayHint[] {
        // we just ignore the range, vscode ignores hints outside of the requested range
        if (!this.inlay_cache_map.has(document.fileName)) {
            // create the cache map
            if (!this.state_map.has(document.fileName)) {
                this.inlay_cache_map.set(document.fileName, []);
                return [];
            }
            const range_map = this.state_map.get(document.fileName)!;
            // here we have to sum up the quantifiers pointing to the same range, as this will be
            // the only information given by the inlay hint.
            const hints = Array.from(range_map.entries()).map(entry => {
                                                            const pos = strToRange(entry[0]).start;
                                                            const hover_text = this.getHoverText(document, pos);
                                                            const value = "QI: ".concat(Array.from(entry[1].values()).reduce((sum, n) => {return sum + n;}, 0).toString());
                                                            const hint = new vscode.InlayHint(pos, value);
                                                            hint.tooltip = hover_text;
                                                            return hint;
                                                          });
            this.inlay_cache_map.set(document.fileName, hints);
        } else {
            this.changed = false;
        }
        const ret = this.inlay_cache_map.get(document.fileName)!;
        return this.inlay_cache_map.get(document.fileName)!;
    }

    public resolveInlayHint(hint: vscode.InlayHint, _token: vscode.CancellationToken): vscode.InlayHint {
        return hint;
    }

    private getHoverText(document: vscode.TextDocument, position: vscode.Position): string|undefined {
        const range_map = this.state_map.get(document.fileName);
        if (range_map === undefined) {
            return undefined;
        }
        const init_range = new vscode.Range(0, 0, 0, 0);
        // get the innermost range by iterating over all ranges.
        let matching_range: vscode.Range = Array.from(range_map.keys()).reduce((cur, range_str) => {
            const range = strToRange(range_str);
            if (range.contains(position) && (cur.contains(range) || cur.isEqual(init_range))) {
                return range;
            } else {
                return cur;
            }
        }, init_range);
        if (matching_range.isEqual(init_range)) {
            return undefined;
        }
        const range_str = JSON.stringify(matching_range);
        const method_map_entries = Array.from(range_map.get(range_str)!.entries());
        const text = method_map_entries.reduce((str, entry) => {return str.concat(`${entry[0]}: ${entry[1]}, `)}, "Quantifier instantiations per method: ").slice(0, -2);
        return text;
    }

    public provideHover(document: vscode.TextDocument, position: vscode.Position, _token: vscode.CancellationToken): vscode.Hover|undefined {
        const text = this.getHoverText(document, position);
        if (text === undefined) {
            return undefined;
        }
        return new vscode.Hover(text!);
    }

    public update(fileName: string, method: string, instantiations: number, range: vscode.Range): void {
        if (!this.state_map.has(fileName)) {
            const range_map = new Map<string, Map<string, number>>();
            this.state_map.set(fileName, range_map);
        }
        const str_range = JSON.stringify(range);
        const range_map = this.state_map.get(fileName)!;
        if (!range_map.has(str_range)) {
            const method_map = new Map<string, number>();
            range_map.set(str_range, method_map);
        }
        range_map.get(str_range)!.set(method, instantiations);
        this.inlay_cache_map.delete(fileName);
        this.changed = true;
    }
}

export class DiagnosticsManager {
    private target: vscode.DiagnosticCollection;
    private procDestructors: Set<util.KillFunction> = new Set();
    private verificationStatus: vscode.StatusBarItem;
    private killAllButton: vscode.StatusBarItem;
    private runCount = 0;
    private quantifierInstantiationsProvider: QuantifierInstantiationsProvider;
    private quantifierChosenTriggersProvider: QuantifierChosenTriggersProvider;

    public constructor(target: vscode.DiagnosticCollection, verificationStatus: vscode.StatusBarItem, killAllButton: vscode.StatusBarItem) {
        this.target = target;
        this.verificationStatus = verificationStatus;
        this.killAllButton = killAllButton;
        this.quantifierInstantiationsProvider = new QuantifierInstantiationsProvider();
        this.quantifierChosenTriggersProvider = new QuantifierChosenTriggersProvider();
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


    public async verify(prusti: dependencies.PrustiLocation, serverAddress: string, targetPath: string, target: VerificationTarget, skip_verification: boolean, selective_verify: string | undefined): Promise<void> {
        // Prepare verification
        this.runCount += 1;
        const currentRun = this.runCount;
        util.log(`Preparing verification run #${currentRun}.`);
        this.killAll();
        this.killAllButton.show();

        // Run verification
        const escapedFileName = path.basename(targetPath).replace("$", "\\$");
        const prevStatus = this.verificationStatus.text;

        if (!skip_verification) {
            this.verificationStatus.text = `$(sync~spin) Verifying ${target} '${escapedFileName}'...`;
        } else {
            this.verificationStatus.text =  `$(sync~spin) Analyzing ${target} '${escapedFileName}'...`;
        }

        const verificationDiagnostics = new VerificationDiagnostics();
        let durationSecMsg: string | null = null;
        const crashErrorMsg = "Prusti encountered an unexpected error. " +
            "We would appreciate a [bug report](https://github.com/viperproject/prusti-dev/issues/new). " +
            "See the log (View -> Output -> Prusti Assistant) for more details.";
        let crashed = false;
        try {
            let status: VerificationStatus, duration: util.Duration;
            util.log("starting verification");
            if (target === VerificationTarget.Crate) {
                [status, duration] = await queryCrateDiagnostics(
                    prusti,
                    targetPath,
                    serverAddress,
                    this.procDestructors,
                    skip_verification,
                    selective_verify,
                    verificationDiagnostics,
                    this.target,
                    this.quantifierInstantiationsProvider,
                    this.quantifierChosenTriggersProvider,
                );
            } else {
                [status, duration] = await queryProgramDiagnostics(
                    prusti,
                    targetPath,
                    serverAddress,
                    this.procDestructors,
                    skip_verification,
                    selective_verify,
                    verificationDiagnostics,
                    this.target,
                    this.quantifierInstantiationsProvider,
                    this.quantifierChosenTriggersProvider,
                );
            }

            durationSecMsg = (duration[0] + duration[1] / 1e9).toFixed(1);
            //verificationDiagnostics.addAll(diagnostics);
            if (status === VerificationStatus.Crash) {
                crashed = true;
                util.log("Prusti encountered an unexpected error.");
                util.userError(crashErrorMsg);
            }
            if (status === VerificationStatus.Errors && !verificationDiagnostics.hasErrors()) {
                crashed = true;
                util.log("The verification failed, but there are no errors to report.");
                // util.userError(crashErrorMsg);
                // put this back in once we dont have to create a fake error
                // to avoid caching of the result for no-verify flag..
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
            this.killAllButton.hide();
            //verificationDiagnostics.renderIn(this.target);
            let prustiErrors = verificationDiagnostics.countPrustiErrors();
            if (crashed) {
                this.verificationStatus.text = `$(error) Verification of ${target} '${escapedFileName}' failed with an unexpected error`;
                this.verificationStatus.command = "workbench.action.output.toggleOutput";
            } else if (verificationDiagnostics.hasErrors() && prustiErrors > 0) {
                const noun = prustiErrors === 1 ? "error" : "errors";
                this.verificationStatus.text = `$(error) Verification of ${target} '${escapedFileName}' failed with ${prustiErrors} ${noun} (${durationSecMsg} s)`;
                this.verificationStatus.command = "workbench.action.problems.focus";
            } else if (verificationDiagnostics.hasErrors() && prustiErrors == 0) {
                const counts = verificationDiagnostics.countsBySeverity();
                const errors = counts.get(vscode.DiagnosticSeverity.Error);
                const noun = errors === 1 ? "error" : "errors";
                this.verificationStatus.text = `$(error) Compilation of ${target} '${escapedFileName}' failed with ${errors} ${noun} (${durationSecMsg} s)`;
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
            if (skip_verification) {
                this.verificationStatus.text = prevStatus;
            }
        }
    }
}
