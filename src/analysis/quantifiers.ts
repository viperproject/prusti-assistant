import * as util from "./../util";
import * as vscode from "vscode";
import { parseSpanRange } from "./diagnostics"
import { PrustiLineConsumer } from "./prusti_line_consumer"

function strToRange(range_str: string): vscode.Range {
    const arr = JSON.parse(range_str) as vscode.Position[];
    return new vscode.Range(arr[0], arr[1]);
}

export class QuantifierChosenTriggersProvider implements vscode.HoverProvider, PrustiLineConsumer {
    // key1: fileName, key2: stringified range, value: [quantifier string, triggers string]
    private state_map: Map<string, Map<string, [string, string]>>;
    private hover_register: vscode.Disposable;
    public constructor() {
        this.state_map = new Map<string, Map<string, [string, string]>>();
        this.hover_register = vscode.languages.registerHoverProvider('rust', this);
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

    public dispose() {
        this.hover_register.dispose();
    }

    public tryConsumeLine(line: string, isCrate: boolean, _programPath: string): boolean {
        const msg = util.getMessage(line, isCrate);
        if (msg === undefined) {
            return false;
        }
        const qctm_str = "quantifier_chosen_triggers_message";
        if (msg.message.startsWith(qctm_str)) {
            if (msg.spans.length !== 1) {
                util.log("ERROR: multiple spans for a quantifier.");
            }
            const span = msg.spans[0];
            const range = parseSpanRange(span);
            const fileName = span.file_name;
            const parsed_m = JSON.parse(msg.message.substring(qctm_str.length));
            const viper_quant = parsed_m["viper_quant"];
            const triggers = parsed_m["triggers"];

            this.update(fileName, viper_quant, triggers, range);
            return true;
        }
        return false;
    }
}

export class QuantifierInstantiationsProvider implements vscode.InlayHintsProvider, vscode.HoverProvider, PrustiLineConsumer {
    // key1: fileName, key2: stringified range, key3: method, value: n_instantiations
    // note: we use the stringified range as identifier because Map uses strict equality "===" to
    // check for key equality, which does not work with newly constructed ranges.
    private state_map: Map<string, Map<string, Map<string, number>>>;
    // we cache the inlayHints for each file until we get a change
    private inlay_cache_map: Map<string, vscode.InlayHint[]>
    private inlay_register: vscode.Disposable;
    private hover_register: vscode.Disposable;
    private changed: boolean = false;

    public constructor() {
        this.state_map = new Map<string, Map<string, Map<string, number>>>();
        this.inlay_cache_map = new Map<string, vscode.InlayHint[]>();
        this.hover_register = vscode.languages.registerHoverProvider('rust', this);
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

    public dispose() {
        this.inlay_register.dispose();
        this.hover_register.dispose();
    }

    public tryConsumeLine(line: string, isCrate: boolean, _programPath: string): boolean {
        // TODO: check with crates
        const msg = util.getMessage(line, isCrate);
        if (msg === undefined) {
            return false;
        }
        const qim_str = "quantifier_instantiations_message";
        if (msg.message.startsWith(qim_str)) {
            if (msg.spans.length !== 1) {
                util.log("ERROR: multiple spans for a quantifier.");
            }
            const span = msg.spans[0];
            const range = parseSpanRange(span);
            const fileName = span.file_name;
            const parsed_m = JSON.parse(msg.message.substring(qim_str.length));
            const method = parsed_m["method"];
            const instantiations = parsed_m["instantiations"];

            this.update(fileName, method, instantiations, range);
            return true;
        }
        return false;
    }
}
