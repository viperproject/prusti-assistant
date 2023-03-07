import * as util from "../util";
import * as vscode from "vscode";
import * as path from "path";
import { PrustiMessageConsumer, parseSpanRange, Message, CargoMessage, dummyRange } from "./message"
import { VerificationArgs, VerificationTarget } from "../verification"

function strToRange(rangeStr: string): vscode.Range {
    const arr = JSON.parse(rangeStr) as vscode.Position[];
    return new vscode.Range(arr[0], arr[1]);
}

interface QuantifierChosenTrigger {
    viper_quant: string,
    triggers: string,
}
export class QuantifierChosenTriggersProvider implements vscode.HoverProvider, PrustiMessageConsumer {
    // key1: fileName, key2: stringified range, value: [quantifier string, triggers string]
    private stateMap: Map<string, Map<string, [string, string]>>;
    private hoverRegister: vscode.Disposable;
    private onDocumentChangeRegister: vscode.Disposable;
    private token = "quantifierChosenTriggersMessage";

    public constructor() {
        this.stateMap = new Map<string, Map<string, [string, string]>>();
        this.hoverRegister = vscode.languages.registerHoverProvider('rust', this);
        this.onDocumentChangeRegister = this.registerOnDocumentChange();
    }

    private registerOnDocumentChange(): vscode.Disposable {
        return vscode.workspace.onDidChangeTextDocument(
            (event: vscode.TextDocumentChangeEvent) => {
                if (event.document.languageId === "rust") {
                    this.invalidateDocument(event.document.fileName);
                }
            });
    }

    public invalidateDocument(fileName: string): void {
        util.log(`QCTP: invalidate ${fileName}`);
        this.stateMap.set(fileName, new Map());
    }

    private getHoverText(document: vscode.TextDocument, position: vscode.Position): vscode.MarkdownString|undefined {
        const rangeMap = this.stateMap.get(document.fileName);
        if (rangeMap === undefined) {
            return undefined;
        }
        const initRange = dummyRange();
        // get the innermost range by iterating over all ranges.
        const matchingRange: vscode.Range = Array.from(rangeMap.keys()).reduce((cur, rangeStr) => {
            const range = strToRange(rangeStr);
            if (range.contains(position) && (cur.contains(range) || cur.isEqual(initRange))) {
                return range;
            } else {
                return cur;
            }
        }, initRange);
        if (matchingRange.isEqual(initRange)) {
            return undefined;
        }
        const rangeStr = JSON.stringify(matchingRange);
        const [quantifier, triggers] = rangeMap.get(rangeStr)!;
        const md_text = new vscode.MarkdownString();
        md_text.appendMarkdown("**Viper quantifier:**");
        md_text.appendText(`\n${quantifier}\n`);
        md_text.appendMarkdown("**Viper triggers:**");
        md_text.appendText(`\n${triggers}`);
        return md_text;
    }

    public provideHover(document: vscode.TextDocument, position: vscode.Position, _token: vscode.CancellationToken): vscode.Hover|undefined {
        const text = this.getHoverText(document, position);
        if (text === undefined) {
            return undefined;
        }
        return new vscode.Hover(text);
    }

    public reset(): void {
        util.log("QCTP: reset");
        this.stateMap = new Map();
    }

    public update(fileName: string, quantifier: string, triggers: string, range: vscode.Range): void {
        if (!this.stateMap.has(fileName)) {
            const rangeMap = new Map<string, [string, string]>();
            this.stateMap.set(fileName, rangeMap);
        }
        const strRange = JSON.stringify(range);
        const rangeMap = this.stateMap.get(fileName)!;
        rangeMap.set(strRange, [quantifier, triggers]);
    }

    public dispose(): void {
        this.hoverRegister.dispose();
        this.onDocumentChangeRegister.dispose();
    }

    public processMessage(msg: Message, vArgs: VerificationArgs): void {
        const isCrate = vArgs.target === VerificationTarget.Crate;
        if (msg.spans.length !== 1) {
            util.log("ERROR: multiple spans for a quantifier.");
        }
        const span = msg.spans[0];
        const range = parseSpanRange(span);
        const fileName = span.file_name;
        const parsedMsg = JSON.parse(msg.message.substring(this.token.length)) as QuantifierChosenTrigger;
        const viperQuant = parsedMsg["viper_quant"];
        const triggers = parsedMsg["triggers"];

        util.log("QuantifierChosenTriggersProvider consumed msg");
        this.update(isCrate ? path.join(vArgs.targetPath, fileName) : fileName, viperQuant, triggers, range);
    }

    public processCargoMessage(msg: CargoMessage, vArgs: VerificationArgs): void {
        this.processMessage(msg.message, vArgs);
    }
}

interface QuantifierInstantiation {
    method: string,
    instantiations: number,
}

export class QuantifierInstantiationsProvider implements vscode.InlayHintsProvider, vscode.HoverProvider, PrustiMessageConsumer {
    // key1: fileName, key2: stringified range, key3: method, value: n_instantiations
    // note: we use the stringified range as identifier because Map uses strict equality "===" to
    // check for key equality, which does not work with newly constructed ranges.
    private stateMap: Map<string, Map<string, Map<string, number>>>;
    // we cache the inlayHints for each file until we get a change
    private inlayCacheMap: Map<string, vscode.InlayHint[]>
    private inlayRegister: vscode.Disposable;
    private hoverRegister: vscode.Disposable;
    private onDocumentChangeRegister: vscode.Disposable;
    private changed = false;
    private intervalRegister: ReturnType<typeof setInterval>;
    private token = "quantifierInstantiationsMessage";

    public constructor() {
        this.stateMap = new Map<string, Map<string, Map<string, number>>>();
        this.inlayCacheMap = new Map<string, vscode.InlayHint[]>();
        this.hoverRegister = vscode.languages.registerHoverProvider('rust', this);
        this.inlayRegister = vscode.languages.registerInlayHintsProvider('rust', this);
        this.onDocumentChangeRegister = this.registerOnDocumentChange();
        this.intervalRegister = setInterval(() => {
            if (this.changed) {
                this.changed = false;
                this.reregisterInlayHintsProvider();
            }
        }, 1000);
    }

    private reregisterInlayHintsProvider(): void {
        this.inlayRegister.dispose();
        this.inlayRegister = vscode.languages.registerInlayHintsProvider('rust', this);
        util.log("Successfully reregistered InlayHintsProvider");
    }

    private registerOnDocumentChange(): vscode.Disposable {
        return vscode.workspace.onDidChangeTextDocument(
            (event: vscode.TextDocumentChangeEvent) => {
                if (event.document.languageId === "rust") {
                    this.invalidateDocument(event.document.fileName);
                }
            });
    }

    public invalidateDocument(fileName: string): void {
        util.log(`QIP: invalidate ${fileName}`);
        this.stateMap.set(fileName, new Map());
        this.inlayCacheMap.set(fileName, []);
        this.reregisterInlayHintsProvider();
    }

    public reset(): void {
        util.log("QIP: reset");
        this.stateMap = new Map();
        this.inlayCacheMap = new Map();
        this.reregisterInlayHintsProvider();
    }

    public provideInlayHints(document: vscode.TextDocument, _range: vscode.Range, _token: vscode.CancellationToken): vscode.InlayHint[] {
        // we just ignore the range, vscode ignores hints outside of the requested range
        if (!this.inlayCacheMap.has(document.fileName)) {
            // create the cache map
            if (!this.stateMap.has(document.fileName)) {
                this.inlayCacheMap.set(document.fileName, []);
                return [];
            }
            const rangeMap = this.stateMap.get(document.fileName)!;
            // here we have to sum up the quantifiers pointing to the same range, as this will be
            // the only information given by the inlay hint.
            const hints = Array.from(rangeMap.entries()).map(entry => {
                                                            const pos = strToRange(entry[0]).start;
                                                            const hoverText = this.getHoverText(document, pos);
                                                            const value = "QI: ".concat(Array.from(entry[1].values()).reduce((sum, n) => {return sum + n;}, 0).toString());
                                                            const hint = new vscode.InlayHint(pos, value);
                                                            hint.tooltip = hoverText;
                                                            return hint;
                                                          });
            this.inlayCacheMap.set(document.fileName, hints);
        }
        const ret = this.inlayCacheMap.get(document.fileName)!;
        return ret;
    }

    public resolveInlayHint(hint: vscode.InlayHint, _token: vscode.CancellationToken): vscode.InlayHint {
        return hint;
    }

    private getHoverText(document: vscode.TextDocument, position: vscode.Position): vscode.MarkdownString|undefined {
        const rangeMap = this.stateMap.get(document.fileName);
        if (rangeMap === undefined) {
            return undefined;
        }
        const initRange = dummyRange();
        // get the innermost range by iterating over all ranges.
        const matchingRange: vscode.Range = Array.from(rangeMap.keys()).reduce((cur, rangeStr) => {
            const range = strToRange(rangeStr);
            if (range.contains(position) && (cur.contains(range) || cur.isEqual(initRange))) {
                return range;
            } else {
                return cur;
            }
        }, initRange);
        if (matchingRange.isEqual(initRange)) {
            return undefined;
        }
        const rangeStr = JSON.stringify(matchingRange);
        const methodMapEntries = Array.from(rangeMap.get(rangeStr)!.entries());
        const md_text = new vscode.MarkdownString("**Quantifier instantiations per method:**");
        md_text.appendText(methodMapEntries.reduce((str, entry) => {return str.concat(`${entry[0]}: ${entry[1]}, `)}, "\n").slice(0, -2));
        return md_text;
    }

    public provideHover(document: vscode.TextDocument, position: vscode.Position, _token: vscode.CancellationToken): vscode.Hover|undefined {
        const text = this.getHoverText(document, position);
        if (text === undefined) {
            return undefined;
        }
        return new vscode.Hover(text);
    }

    public update(fileName: string, method: string, instantiations: number, range: vscode.Range): void {
        if (!this.stateMap.has(fileName)) {
            const rangeMap = new Map<string, Map<string, number>>();
            this.stateMap.set(fileName, rangeMap);
        }
        const strRange = JSON.stringify(range);
        const rangeMap = this.stateMap.get(fileName)!;
        if (!rangeMap.has(strRange)) {
            const methodMap = new Map<string, number>();
            rangeMap.set(strRange, methodMap);
        }
        rangeMap.get(strRange)!.set(method, instantiations);
        this.inlayCacheMap.delete(fileName);
        this.changed = true;
    }

    public dispose(): void {
        clearInterval(this.intervalRegister);
        this.inlayRegister.dispose();
        this.hoverRegister.dispose();
        this.onDocumentChangeRegister.dispose();
    }

    public processMessage(msg: Message, vArgs: VerificationArgs): void {
        const isCrate = vArgs.target === VerificationTarget.Crate;
        if (msg.spans.length !== 1) {
            util.log("ERROR: multiple spans for a quantifier.");
        }
        const span = msg.spans[0];
        const range = parseSpanRange(span);
        const fileName = span.file_name;
        const parsedMsg = JSON.parse(msg.message.substring(this.token.length)) as QuantifierInstantiation;
        const method = parsedMsg["method"];
        const instantiations = parsedMsg["instantiations"];

        util.log("QuantifierInstantiationsProvider consumed msg");
        this.update(isCrate ? path.join(vArgs.targetPath, fileName) : fileName, method, instantiations, range);
    }

    public processCargoMessage(msg: CargoMessage, vArgs: VerificationArgs): void {
        this.processMessage(msg.message, vArgs);
    }
}
