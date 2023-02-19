import * as vscode from "vscode";
import * as util from "./../util";
import { VerificationResult, parseVerificationResult } from "./verificationResult";
import { failedVerificationDecorationType, successfulVerificationDecorationType } from "./../toolbox/decorations";
import { FunctionRef, parseCompilerInfo, CompilerInfo } from "./compilerInfo";
import { PrustiLineConsumer } from "./prusti_line_consumer"

function pathKey(rootPath: string, methodIdent: string): string {
    return rootPath + ":" + methodIdent;
}

export class SelectiveVerificationProvider implements vscode.CodeLensProvider, vscode.CodeActionProvider, PrustiLineConsumer {
    private lens_register: vscode.Disposable;
    private actions_register: vscode.Disposable;
    private decorations: Map<string, vscode.TextEditorDecorationType[]>;
    // for proc_defs we also have a boolean on whether these values
    // were already requested (for codelenses)
    private procedureDefs: Map<string, FunctionRef[]>;
    private functionCalls: Map<string, FunctionRef[]>;
    private verificationInfo: Map<string, VerificationResult[]>;
    private rangeMap: Map<string, [vscode.Range, string]>;

    public constructor() {
        this.lens_register = vscode.languages.registerCodeLensProvider('rust', this);
        this.actions_register = vscode.languages.registerCodeActionsProvider('rust', this);
        this.decorations = new Map();
        this.procedureDefs = new Map();
        this.functionCalls = new Map();
        this.verificationInfo = new Map();
        this.rangeMap = new Map(); 
    }

    public dispose() {
        this.lens_register.dispose();
        this.actions_register.dispose();
    }

    // TODO: I probably broke something here
    public provideCodeLenses(document: vscode.TextDocument, _token: vscode.CancellationToken): vscode.CodeLens[] {
        const codeLenses: vscode.CodeLens[] = [];
        let rootPath = util.getRootPath(document.uri.fsPath);
        let procDefs = this.procedureDefs.get(rootPath);

        procDefs?.forEach((pd: FunctionRef) => {
            if (pd.fileName === document.uri.fsPath) {
                const codeLens = new vscode.CodeLens(pd.range);
                codeLens.command = {
                    title: "✓ Verify " + pd.identifier,
                    command: "prusti-assistant.verify-selective",
                    // TODO: invoke selective verification here
                    arguments: [pd.identifier]
                };
                codeLenses.push(codeLens);
            }
        });
        return codeLenses;
    }

    public provideCodeActions(
            document: vscode.TextDocument,
            range: vscode.Range,
            _context: vscode.CodeActionContext,
            _token: vscode.CancellationToken
        ): vscode.CodeAction[] {
        const codeActions: vscode.CodeAction[] = [];

        // figure out whether or not this file is part of a crate, or a
        // standalone file
        let rootPath = util.getRootPath(document.uri.fsPath);
        let fnCalls = this.functionCalls.get(rootPath);

        if (fnCalls !== undefined) {
            fnCalls.forEach((fc: FunctionRef) => {
                if (fc.fileName === document.fileName && fc.range.contains(range))
                {
                    const codeAction = new vscode.CodeAction(
                        "create external specification " + fc.identifier,
                        vscode.CodeActionKind.QuickFix
                    );
                    codeAction.command = {
                        title: "Verify",
                        command: "prusti-assistant.query-method-signature",
                        arguments: [fc.identifier]
                    };
                    codeActions.push(codeAction);
                }
            });
        }
        return codeActions;
    }

    private displayResults(): void {
        let activeEditor = vscode.window.activeTextEditor;
        let editorFilePath = activeEditor?.document.uri.fsPath;
        if (editorFilePath !== undefined) {
            let rootPath = util.getRootPath(editorFilePath);
            let decorators: vscode.TextEditorDecorationType[] = [];
            this.clearPreviousDecorators(editorFilePath);
            let resultList = this.verificationInfo.get(rootPath);
            resultList?.forEach((res: VerificationResult) => {
                let location = this.rangeMap.get(pathKey(rootPath, res.methodName));
                if (location) {
                    let [range, resFilePath] = location;
                    if (resFilePath === editorFilePath) {
                        let range_line = util.full_line_range(range);
                        var decoration;
                        if (res.success) {
                            decoration = successfulVerificationDecorationType(res.time_ms, res.cached)
                        } else {
                            decoration = failedVerificationDecorationType(res.time_ms, res.cached)
                        }
                        activeEditor?.setDecorations(decoration, [range_line]);
                        decorators.push(decoration);
                    }
                } else {
                    util.log(`Couldn't find location for method ${res.methodName} in ${rootPath}`);
                }
            });
            this.decorations.set(editorFilePath, decorators);
        }
    }

    private clearPreviousDecorators(filePath: string): void {
        let prev = this.decorations.get(filePath);
        if (prev !== undefined) {
            prev.forEach((dec: vscode.TextEditorDecorationType) => {
                vscode.window.activeTextEditor?.setDecorations(dec, []);
            });
        }
    }

    /**
     * very primitive way of causing a re-rendering of the Codelenses in the
     * current file. This was needed because in some cases it took quite a few
     * seconds until they were updated.
     */
    private force_codelens_update(): void {
        const cancel = vscode.languages.registerCodeLensProvider('rust', {
            provideCodeLenses(_document: vscode.TextDocument, _token: vscode.CancellationToken): vscode.CodeLens[] {
                const codeLenses: vscode.CodeLens[] = [];
                return codeLenses;
            }
        });
        cancel.dispose();
    }

    public addCompilerInfo(info: CompilerInfo): void {
        if (info.queriedSource) {
            // yet to be formatted:
            vscode.env.clipboard.writeText(info.queriedSource);
            util.userInfoPopup("Template for extern spec. is now on your clipboard.");
        }

        // create all sorts of data structures that will be practical:
        let rootPath = info.rootPath;
        util.log(`Adding CompilerInfo to path: ${rootPath}`);
        this.procedureDefs.set(rootPath, info.procedureDefs);
        this.functionCalls.set(rootPath, info.functionCalls);

        info.procedureDefs.forEach((pd: FunctionRef) => {
            let key: string = pathKey(rootPath, pd.identifier);
            this.rangeMap.set(key, [pd.range, pd.fileName]);
        });

        this.force_codelens_update();
    }

    public tryConsumeLine(line: string, isCrate: boolean, programPath: string): boolean {
        let compilerInfo = parseCompilerInfo(line, isCrate, isCrate ? programPath + "/" : programPath);
        if (compilerInfo !== undefined) {
            this.addCompilerInfo(compilerInfo);
            return true;
        }
        let verificationResult = parseVerificationResult(line, isCrate, programPath);
        if (verificationResult !== undefined) {
            if (this.verificationInfo.get(programPath) === undefined) {
                this.verificationInfo.set(programPath, []);
            }
            this.verificationInfo.get(programPath)!.push(verificationResult);
            this.displayResults();
            return true;
        }
        return false;
    }
}
