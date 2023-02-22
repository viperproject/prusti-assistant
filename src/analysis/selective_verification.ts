import * as vscode from "vscode";
import * as util from "./../util";
import * as config from "./../config";
import { EventEmitter } from "events";
import { VerificationResult, parseVerificationResult } from "./verificationResult";
import { failedVerificationDecorationType, successfulVerificationDecorationType } from "./../toolbox/decorations";
import { FunctionRef, parseCompilerInfo, CompilerInfo } from "./compilerInfo";
import { PrustiMessageConsumer } from "./verification"
import { CallContract, parseCallContracts } from "./encodingInfo"
import { Message, CargoMessage } from "./diagnostics"

function pathKey(rootPath: string, methodIdent: string): string {
    return rootPath + ":" + methodIdent;
}

export class SelectiveVerificationProvider implements vscode.CodeLensProvider, vscode.CodeActionProvider, PrustiMessageConsumer {
    private lens_register: vscode.Disposable;
    private actions_register: vscode.Disposable;
    private definitionRegister: vscode.Disposable;
    private resultOnTabChangeRegister: vscode.Disposable;
    private decorations: Map<string, vscode.TextEditorDecorationType[]>;
    // for proc_defs we also have a boolean on whether these values
    // were already requested (for codelenses)
    private procedureDefs: Map<string, FunctionRef[]>;
    private functionCalls: Map<string, FunctionRef[]>;
    private verificationInfo: Map<string, VerificationResult[]>;
    private rangeMap: Map<string, [vscode.Range, string]>;
    private callContracts: Map<string, CallContract[]>;
    private fileStateMap: Map<string, boolean>;
    private fileStateUpdateEmitter: EventEmitter;

    public constructor() {
        this.decorations = new Map();
        this.procedureDefs = new Map();
        this.functionCalls = new Map();
        this.verificationInfo = new Map();
        this.rangeMap = new Map(); 
        this.callContracts = new Map();
        this.fileStateMap = new Map();
        this.fileStateUpdateEmitter = new EventEmitter();
        this.lens_register = vscode.languages.registerCodeLensProvider('rust', this);
        this.actions_register = vscode.languages.registerCodeActionsProvider('rust', this);
        this.definitionRegister = vscode.languages.registerDefinitionProvider('rust', this);
        this.resultOnTabChangeRegister = this.registerDecoratorOnTabChange();
    }
    

    public dispose() {
        this.lens_register.dispose();
        this.actions_register.dispose();
        this.definitionRegister.dispose();
        this.resultOnTabChangeRegister.dispose();
    }

    // what do we need to do before a verification such that the results
    // from previous verifications will be gone.
    public cleanPreviousRun(programPath: string) {
        this.verificationInfo.set(programPath, []);
    }

    // TODO: I probably broke something here
    public provideCodeLenses(document: vscode.TextDocument, token: vscode.CancellationToken): Promise<vscode.CodeLens[]> {
        return this.codelensPromise(document, token);
    }
    async codelensPromise(
        document: vscode.TextDocument, 
        _token: vscode.CancellationToken
    ): Promise<vscode.CodeLens[]> {
        const codeLenses: vscode.CodeLens[] = [];
        let rootPath = util.getRootPath(document.uri.fsPath);
        let procDefs = this.procedureDefs.get(rootPath);
        let fileState = this.fileStateMap.get(document.uri.fsPath);
        
        
        if (fileState !== undefined ) {
            if (fileState) {
                // it has already been read and we should wait for
                // an update. Should there be an await?
                await new Promise(resolve => {
                    this.fileStateUpdateEmitter.once('updated' + document.uri.fsPath, () => resolve );
                });
            } // otherwise just proceed since this file's current info has not been
            // read yet..

            this.fileStateMap.set(document.uri.fsPath, true);

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
        }
        // await delay(0);
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

    private displayVerificationResults(): void {
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
                        let range_line = util.FullLineRange(range);
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

    public provideDefinition(
        document: vscode.TextDocument, 
        position: vscode.Position, 
        _token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.Definition | vscode.LocationLink[]> {
        if (!config.contractsAsDefinitions()) {
            return [];
        }
        let rootPath = util.getRootPath(document.uri.fsPath);
        let callContracts = this.callContracts.get(rootPath);
        if (callContracts === undefined) {
            return [];
        }
        
        for (const callCont of callContracts) {
            let sameFile = callCont.callLocation.uri.fsPath === document.uri.fsPath;
            let containsPos = callCont.callLocation.range.contains(position);
            if (sameFile && containsPos) {
                return callCont.contractLocations;
            } 
        }
        return [];
    }

    private registerDecoratorOnTabChange(): vscode.Disposable {
        return vscode.window.onDidChangeActiveTextEditor(async (editor: vscode.TextEditor | undefined ) => {
            if (editor && editor.document) {
                if (editor.document.languageId === "rust") {
                    this.displayVerificationResults();
                }
            }
        });
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

        info.distinctFiles.forEach((fileName) => {
            // mark each file's information as "not read yet"
            this.fileStateMap.set(fileName, false);
            // and then notify CodeLensHandlers of the update
            this.fileStateUpdateEmitter.emit('updated' + fileName);
        })
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

    public processMessage(msg: Message, isCrate: boolean, programPath: string): void {
        const ind = msg.message.indexOf("{");
        const token = msg.message.substring(0, ind);
        switch (token) {
            case "encodingInfo": {
                let callContracts = parseCallContracts(msg.message, isCrate, programPath);
                if (callContracts !== undefined) {
                    util.log("Consumed encodingInfo");
                    this.callContracts.set(programPath, callContracts);
                } else {
                    util.log("Invalid encodingInfo");
                }
                break;
            }
            case "compilerInfo": {
                let compilerInfo = parseCompilerInfo(msg.message, isCrate, programPath);
                if (compilerInfo !== undefined) {
                    util.log("Consumed compilerInfo");
                    this.addCompilerInfo(compilerInfo);
                } else {
                    util.log("Invalid compilerInfo");
                }
                break;
            }
            case "ideVerificationResult": {
                let verificationResult = parseVerificationResult(msg.message, isCrate, programPath);
                if (verificationResult !== undefined) {
                    if (this.verificationInfo.get(programPath) === undefined) {
                        this.verificationInfo.set(programPath, []);
                    }
                    this.verificationInfo.get(programPath)!.push(verificationResult);
                    util.log("Consumed ideVerificationResult");
                    this.displayVerificationResults();
                } else {
                    util.log("Invalid ideVerificationResult");
                }
                break;
            }
            default: {
                util.log("ERROR: should never happen.");
            }
        }
    }

    public processCargoMessage(msg: CargoMessage, isCrate: boolean, programPath: string): void {
        this.processMessage(msg.message, isCrate, programPath);
    }
}
