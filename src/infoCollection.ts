import * as vscode from "vscode";
import * as util from "./util";
import * as config from "./config";
import { EventEmitter } from "events";
import { VerificationResult, parseVerificationResult } from "./types/verificationResult";
import { BlockResult, blockResultAnd, parseBlockMessage } from "./types/blockMessage";
import { _successfulCompleteVerificationStartDecorationType, _declarationRangeDecorationType, _declarationRangeEndlVerificationDecorationType, _declarationRangeStartVerificationDecorationType, _failedPartialVerificationDecorationType, failedVerificationDecorationType, failedVerificationTextDecorationType, _successfulCompleteVerificationDecorationType, _successfulCompleteVerificationEndDecorationType, _successfulPartialVerificationDecorationType, successfulVerificationDecorationType, successfulVerificationTextDecorationType } from "./toolbox/decorations";
import { FunctionRef, parseCompilerInfo, CompilerInfo } from "./types/compilerInfo";
import { CallContract, parseCallContracts } from "./types/encodingInfo"
import { PrustiMessageConsumer, Message, CargoMessage } from "./types/message"
import { VerificationArgs, VerificationTarget, VerificationManager } from "./verification"

function pathKey(rootPath: string, methodIdent: string): string {
    return rootPath + ":" + methodIdent;
}

/** A collection of information that is maintained to provide the following
* features:
* - selective verification: there is a codeLens above each function that can
*   be verified, and when clicked on will verify that method only.
* - extern_spec templates: for each function call to a method outside our current
*   crate we provide a CodeAction to generate a extern_spec block for that method.
* - verification results: display within text editor if methods failed or succeeded
*   verification, how long it took, and whether the result was cached.
* - Contracts of calls: for each function call, a user can request the specification
*   of that method, i.e. contract items of that method.
*/
export class InfoCollection implements vscode.CodeLensProvider, vscode.CodeActionProvider, PrustiMessageConsumer {
    private lensRegister: vscode.Disposable;
    private actionRegister: vscode.Disposable;
    private definitionRegister: vscode.Disposable;
    private resultOnTabChangeRegister: vscode.Disposable;

    private decorations: Map<string, vscode.TextEditorDecorationType[]>;
    private lastUpdateTime: number;
    private blockUpdateInterval: number;
    private pathTraversal: Map<number, BlockResult>;
    private blockVerificationInfo: Map<string, BlockResult>;
    private methodStatusChanged: Set<string>;
    private partialVerificactionDecorationRanges: Map<vscode.TextEditorDecorationType, vscode.Range[]>;
    // private inverseRangeMap: Map<vscode.Range, string>;
    // for procedureDefs we also have a boolean on whether these values
    // were already requested (for codelenses)
    private procedureDefs: Map<string, FunctionRef[]>;
    private functionCalls: Map<string, FunctionRef[]>;
    private verificationInfo: Map<string, VerificationResult[]>;
    private rangeMap: Map<string, [vscode.Range, string]>;
    private callContracts: Map<string, CallContract[]>;
    private fileStateMap: Map<string, boolean>;
    private fileStateUpdateEmitter: EventEmitter;
    // we also have a reference to the VerificationManager so that we can tell it which files are
    // affected by the current verification so that other providers can clear these
    // I'm not super happy with this design choice, but for now it is what it is
    private verificationManager: VerificationManager;

    public constructor(verificationManager: VerificationManager) {
        this.decorations = new Map();
        this.lastUpdateTime = Date.now();
        this.blockUpdateInterval = config.blockUpdateInterval();
        this.pathTraversal = new Map();
        this.blockVerificationInfo = new Map();
        this.methodStatusChanged = new Set();
        this.partialVerificactionDecorationRanges = new Map();
        // this.inverseRangeMap = new Map();
        this.procedureDefs = new Map();
        this.functionCalls = new Map();
        this.verificationInfo = new Map();
        this.rangeMap = new Map();
        this.callContracts = new Map();
        this.fileStateMap = new Map();
        this.fileStateUpdateEmitter = new EventEmitter();
        this.verificationManager = verificationManager;
        this.lensRegister = vscode.languages.registerCodeLensProvider('rust', this);
        this.actionRegister = vscode.languages.registerCodeActionsProvider('rust', this);
        this.definitionRegister = vscode.languages.registerDefinitionProvider('rust', this);
        this.resultOnTabChangeRegister = this.registerDecoratorOnTabChange();
    }

    public dispose(): void {
        this.lensRegister.dispose();
        this.actionRegister.dispose();
        this.definitionRegister.dispose();
        this.resultOnTabChangeRegister.dispose();
    }

    /** what do we need to do before a verification such that the results
    * from previous verifications will be gone.
    */
    public clearPreviousRun(programPath: string): void {
        this.verificationInfo.set(programPath, []);

        const editor = vscode.window.activeTextEditor;
        if (editor !== undefined) {
            this.clearPreviousDecorators(editor.document.uri.fsPath);
        }
    }

    /** When opening a new file, check whether it is part of a crate that
    * has been verified before. Before in this context means "during this
    * run"
    */
    public wasVerifiedBefore(programPath: string): boolean {
        const root = util.getRootPath(programPath);
        return (this.verificationInfo.get(root) !== undefined)
    }


    /** CodeLenses should annotate all items in a crate or program that can
    * be verified. They are clickable which will result in a selective
    * verification of this method.
    */
    public provideCodeLenses(document: vscode.TextDocument, _token: vscode.CancellationToken): Promise<vscode.CodeLens[]> {
        return this.codelensPromise(document);
    }

    private async codelensPromise(
        document: vscode.TextDocument,
    ): Promise<vscode.CodeLens[]> {
        const codeLenses: vscode.CodeLens[] = [];
        const rootPath = util.getRootPath(document.uri.fsPath);
        const procDefs = this.procedureDefs.get(rootPath);
        const fileState = this.fileStateMap.get(document.uri.fsPath);


        if (fileState === undefined) {
            return [];
        } else if (fileState) {
            // it has already been read and we should wait for an update
            // otherwise providing this info again will only cause the ranges
            // to be out-of-date, meaning they end up in the wrong places.
            await new Promise(resolve => {
                this.fileStateUpdateEmitter.once('updated' + document.uri.fsPath, () => resolve);
            });
        }
        // otherwise just proceed since this file's current info has not been
        // read before, so the stored info is still correct (unless of
        // course people start editing files from other editors, but that's
        // not our concern here)

        this.fileStateMap.set(document.uri.fsPath, true);
        // mark the info for this file as "read" or dirty or however to interpret this

        procDefs?.forEach((pd: FunctionRef) => {
            if (pd.fileName === document.uri.fsPath) {
                const codeLens = new vscode.CodeLens(pd.range);
                codeLens.command = {
                    title: "✓ Verify",
                    command: "prusti-assistant.verify-selective",
                    arguments: [pd.identifier]
                };
                codeLenses.push(codeLens);
            }
        });
        return codeLenses;
    }

    /* CodeActions should be provided at every function call. When they
    * are invoked, we will run prusti to request a block of code that
    * contains a template for creating extern_specs for that function.
    */
    public provideCodeActions(
        document: vscode.TextDocument,
        range: vscode.Range,
        _context: vscode.CodeActionContext,
        _token: vscode.CancellationToken,
    ): vscode.CodeAction[] {
        const codeActions: vscode.CodeAction[] = [];

        const rootPath = util.getRootPath(document.uri.fsPath);
        const fnCalls = this.functionCalls.get(rootPath);

        if (fnCalls !== undefined) {
            fnCalls.forEach((fc: FunctionRef) => {
                if (fc.fileName === document.fileName && fc.range.contains(range)) {
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

    /** To make the results of a verification run more readable, we add
    * some decorations here. We display a green checkmark or red cross
    * depending on the result, and also some greyed out text, containing
    * the duration for the verification, and whether the result is cached
    * or not
    */
   // TODO:
   //       clear decorations only for methods where the partial or complete result changed?
   //       if a method reports a failure just leave the partial results. (maybe change bars to red?)
   //       make sure blockMessage.method actually matches in format with the method names in this.rangeMap
    private displayVerificationResults(): void {
        const activeEditor = vscode.window.activeTextEditor;
        const editorFilePath = activeEditor?.document.uri.fsPath;
        if (editorFilePath !== undefined) {
            const methodsVerified: Set<string> = new Set();
            const rootPath = util.getRootPath(editorFilePath);
            const decorators: vscode.TextEditorDecorationType[] = [];
            this.clearPreviousDecorators(editorFilePath);
            const resultList = this.verificationInfo.get(rootPath);
            resultList?.forEach((res: VerificationResult) => {
                const location = this.rangeMap.get(pathKey(rootPath, res.methodName));
                if (location) {
                    const [range, resFilePath] = location;
                    if (resFilePath === editorFilePath) {
                        const range_line = util.fullLineRange(range);
                        let decoration;
                        if (res.success) {
                            // green out the gutter and only display the time and cached text if generating block messages.
                            // unless the method has only one line, then behave as before
                            if (config.generateBlockMessages()){
                                methodsVerified.add(res.methodName);
                                if (range.start.line === range.end.line || range.end.line - range.start.line === 1) {
                                    decoration = successfulVerificationDecorationType(res.time_ms, res.cached);
                                } else {
                                    const rangeStart = new vscode.Range(range.start, range.start);
                                    const rangeEnd = new vscode.Range(range.end, range.end);
                                    const rangeBody = new vscode.Range(range.start.translate(1), range.end.translate(-1));
                                    this.partialVerificactionDecorationRanges.get(_successfulCompleteVerificationStartDecorationType)!.push(rangeStart);
                                    this.partialVerificactionDecorationRanges.get(_successfulCompleteVerificationDecorationType)!.push(rangeBody);
                                    this.partialVerificactionDecorationRanges.get(_successfulCompleteVerificationEndDecorationType)!.push(rangeEnd);
                                    decoration = successfulVerificationTextDecorationType(res.time_ms, res.cached);
                                }
                            } else {
                                decoration = successfulVerificationDecorationType(res.time_ms, res.cached);
                            }
                        } else {
                            // also only display the fail icon if the method is very short if generating block messages.
                            if (config.generateBlockMessages()) {
                                methodsVerified.add(res.methodName);
                                if (range.start.line === range.end.line || range.end.line - range.start.line === 1) {
                                    decoration = failedVerificationDecorationType(res.time_ms, res.cached);
                                } else {
                                    decoration = failedVerificationTextDecorationType(res.time_ms, res.cached);
                                }
                            } else {
                              decoration = failedVerificationDecorationType(res.time_ms, res.cached);
                            }
                        }
                        activeEditor?.setDecorations(decoration, [range_line]);
                        decorators.push(decoration);
                    }
                } else {
                    util.log(`Couldn't find location for method ${res.methodName} in ${rootPath}`);
                }
            });

            this.blockVerificationInfo.forEach((blockResult: BlockResult, _) => 
                {
                    if (editorFilePath === blockResult.file){
                        // TODO: if encountering a method for the first time in this call (including the VerificationResult)
                        // pass, insert the yellow bars and declaration end icons
                        if (!methodsVerified.has(blockResult.method)){
                            methodsVerified.add(blockResult.method);
                            const range = this.rangeMap.get(blockResult.method)![0]
                            // require at least one line of code to display anything
                            if (range.start.line === range.end.line) return;
                            if (range.end.line - range.start.line === 1) return;
                            const rangeStart = new vscode.Range(range.start, range.start);
                            const rangeEnd = new vscode.Range(range.end, range.end);
                            const rangeBody = new vscode.Range(range.start.translate(1), range.end.translate(-1));
                            this.partialVerificactionDecorationRanges.get(_declarationRangeStartVerificationDecorationType)!.push(rangeStart);
                            this.partialVerificactionDecorationRanges.get(_declarationRangeDecorationType)!.push(rangeBody);
                            this.partialVerificactionDecorationRanges.get(_declarationRangeEndlVerificationDecorationType)!.push(rangeEnd);
                        }
                        if (blockResult.result) {
                            this.partialVerificactionDecorationRanges.get(_successfulPartialVerificationDecorationType)!.push(blockResult.range)
                        } else {
                            this.partialVerificactionDecorationRanges.get(_failedPartialVerificationDecorationType)!.push(blockResult.range)
                        }
                    }
                }
            );
            this.partialVerificactionDecorationRanges.forEach((ranges, dec) => {
                activeEditor?.setDecorations(dec, ranges);
            });

            this.decorations.set(editorFilePath, decorators);
            this.methodStatusChanged.clear();
            this.lastUpdateTime = Date.now();
        }
    }

    /** When calling functions, it would often be useful to see the full
    * contract of this call. More as a prototype, we provide the spans of the
    * contracts as definitions, so a user can "peek-definitions" to see
    * the various items of a calls contract. This feature is configurable
    */
    public provideDefinition(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.Definition | vscode.LocationLink[]> {
        if (!config.contractsAsDefinitions()) {
            return [];
        }
        const rootPath = util.getRootPath(document.uri.fsPath);
        const callContracts = this.callContracts.get(rootPath);
        if (callContracts === undefined) {
            return [];
        }

        for (const contract of callContracts) {
            const sameFile = contract.callLocation.uri.fsPath === document.uri.fsPath;
            const containsPos = contract.callLocation.range.contains(position);
            if (sameFile && containsPos) {
                return contract.contractLocations;
            }
        }
        return [];
    }

    /** When changing the tab of a file, in case there is a verification-result
    * to display, this function makes sure this is happening.
    */
    private registerDecoratorOnTabChange(): vscode.Disposable {
        return vscode.window.onDidChangeActiveTextEditor((editor: vscode.TextEditor | undefined) => {
            if (editor && editor.document) {
                if (editor.document.languageId === "rust") {
                    this.displayVerificationResults();
                }
            }
        });
    }

    /** Clear decorators of a file. Needed when the same file or crate is
    * verified multiple times, because otherwise some of the decorations
    * start to appear twice.
    */
    private clearPreviousDecorators(filePath: string): void {
        const prev = this.decorations.get(filePath);
        if (prev !== undefined) {
            prev.forEach((dec: vscode.TextEditorDecorationType) => {
                vscode.window.activeTextEditor?.setDecorations(dec, []);
            });
        }

        this.partialVerificactionDecorationRanges = new Map([
            [_successfulPartialVerificationDecorationType, []],
            [_successfulCompleteVerificationStartDecorationType, []],
            [_successfulCompleteVerificationDecorationType, []],
            [_successfulCompleteVerificationEndDecorationType, []],
            [_failedPartialVerificationDecorationType, []],
            [_declarationRangeStartVerificationDecorationType, []],
            [_declarationRangeDecorationType, []],
            [_declarationRangeEndlVerificationDecorationType, []]
        ])
        this.partialVerificactionDecorationRanges.forEach((_, dec) => {
                vscode.window.activeTextEditor?.setDecorations(dec, []);
            });
    }

    // private clearPreviousDecoratorsInRange(filePath: string, eraseRange: vscode.Range): void {
    //   this.decorationRanges.forEach((ranges: vscode.Range[], decoration: vscode.TextEditorDecorationType) =>
    //     {
    //       const newRanges = ranges.filter((range: vscode.Range) => !eraseRange.contains(range));
    //       this.decorationRanges.set(decoration, newRanges);
    //       vscode.window.activeTextEditor?.setDecorations(decoration, newRanges);
    //     }
    //   );
    //   const prev = this.decorations.get(filePath);
    //   prev?.forEach((dec: vscode.TextEditorDecorationType) => 
    //       {
    //         const newRanges = ranges.filter((range: vscode.Range) => !eraseRange.contains(range));
    //         vscode.window.activeTextEditor?.setDecorations(dec, []);
    //       }
    //   );
    // }

    /** Very primitive way of causing a re-rendering of the Codelenses in the
     * current file. This was needed because in some cases it took quite a few
     * seconds until they were updated.
     */
    private forceCodelensUpdate(): void {
        const cancel = vscode.languages.registerCodeLensProvider('rust', {
            provideCodeLenses(_document: vscode.TextDocument, _token: vscode.CancellationToken): vscode.CodeLens[] {
                const codeLenses: vscode.CodeLens[] = [];
                return codeLenses;
            }
        });
        cancel.dispose();
    }

    /** Update the current partial verification results for a range/block
     * in a given path.
     */
    private updatePath(blockResult: BlockResult): void {
        // TODO: currently assuming that blockResult.method eludes which file the range belongs to,
        // which is probably not the case
        const previousPathResult = this.pathTraversal.get(blockResult.pathId);
        if (previousPathResult !== undefined) {
            const currentBlockResult = this.blockVerificationInfo.get(blockResult.rangeId);
            if (currentBlockResult === undefined) {
                // no results for this range yet
                this.blockVerificationInfo.set(previousPathResult.rangeId, previousPathResult);
                this.methodStatusChanged.add(previousPathResult.method);
            } else {
              // no need to update anything if the result did not change
              // sufficient xor check since the result should never go from false to true
              if (previousPathResult.result && !currentBlockResult.result) {
                  const newBlockResult = blockResultAnd(previousPathResult, currentBlockResult);
                  this.blockVerificationInfo.set(newBlockResult.rangeId, newBlockResult);
                  this.methodStatusChanged.add(blockResult.method)
                }
            }
        }
        // if this is the first block of a path, no need to actually update the results yet
        this.pathTraversal.set(blockResult.pathId, blockResult);
    }

    public addCompilerInfo(info: CompilerInfo): void {
        // if prusti returns an extern_spec template, we move it to the
        // clipboard. This happens independently of whether it was actually
        // requested, so currently there is no error if this fails.
        if (info.queriedSource) {
            void vscode.env.clipboard.writeText(info.queriedSource).then(() => {
            util.userInfoPopup("Template for extern spec. is now on your clipboard.");
            });
        }

        // create all sorts of data structures that will be practical:
        const rootPath = info.rootPath;
        util.log(`Adding CompilerInfo to path: ${rootPath}`);
        this.procedureDefs.set(rootPath, info.procedureDefs);
        this.functionCalls.set(rootPath, info.functionCalls);

        info.distinctFiles.forEach((fileName) => {
            // mark each file's information as "not read yet"
            this.fileStateMap.set(fileName, false);
            // and then notify CodeLensHandlers of the update
            this.fileStateUpdateEmitter.emit('updated' + fileName);
            // we also call the verification manager so that affected files can be reset
            this.verificationManager.prepareFile(fileName);
        })
        info.procedureDefs.forEach((pd: FunctionRef) => {
            const key: string = pathKey(rootPath, pd.identifier);
            this.rangeMap.set(key, [pd.range, pd.fileName]);
        });

        this.forceCodelensUpdate();
    }

    public processMessage(msg: Message, vArgs: VerificationArgs): void {
        const isCrate = vArgs.target === VerificationTarget.Crate;
        const rootPath = vArgs.targetPath;
        const ind = msg.message.indexOf("{");
        const token = msg.message.substring(0, ind);
        switch (token) {
            case "encodingInfo": {
                const callContracts = parseCallContracts(msg.message, isCrate, rootPath);
                if (callContracts !== undefined) {
                    util.log("Consumed encodingInfo");
                    this.callContracts.set(rootPath, callContracts);
                } else {
                    util.log("Invalid encodingInfo");
                }
                break;
            }
            case "compilerInfo": {
                const compilerInfo = parseCompilerInfo(msg.message, isCrate, rootPath);
                if (compilerInfo !== undefined) {
                    util.log("Consumed compilerInfo");
                    this.addCompilerInfo(compilerInfo);
                } else {
                    util.log("Invalid compilerInfo");
                }
                break;
            }
            case "ideVerificationResult": {
                const verificationResult = parseVerificationResult(msg.message);
                if (verificationResult !== undefined) {
                    if (this.verificationInfo.get(rootPath) === undefined) {
                        this.verificationInfo.set(rootPath, []);
                    }
                    this.verificationInfo.get(rootPath)!.push(verificationResult);
                    util.log("Consumed ideVerificationResult");
                    this.methodStatusChanged.add(verificationResult.methodName);
                    this.displayVerificationResults();
                } else {
                    util.log("Invalid ideVerificationResult");
                }
                break;
            }
            case "pathProcessedMessage":
            case "blockReachedMessage": {
              const blockResult = parseBlockMessage(msg.message, token);
              if (blockResult !== undefined){
                // mark current block of path as verified (mark block as verified overall if there hasn't been a failures yet)
                // and advance current block of path to blockResult.span (should be span of a label/block)
                this.updatePath(blockResult);
                const time = Date.now()
                if (time - this.lastUpdateTime > this.blockUpdateInterval){
                    // there should always be an ideVerificationResult at the end which calls displayVerificationResults
                    // unconditionally, so there is no need to make sure the last of these messages is displayed.
                    this.displayVerificationResults();
                    util.log(`Consumed ${token}`);
                }
              } else {
                util.log(`Invalid ${token}: ${msg.message}`)
              }
              break;
            }
            default: {
                util.log("ERROR: should never happen.");
            }
        }
    }

    public processCargoMessage(msg: CargoMessage, vArgs: VerificationArgs): void {
        this.processMessage(msg.message, vArgs);
    }
}
