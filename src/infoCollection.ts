import * as vscode from "vscode";
import * as util from "./util";
import * as config from "./config";
import { EventEmitter } from "events";
import { parseVerificationResult } from "./types/verificationResult";
import { BlockResult, parseBlockMessage } from "./types/blockMessage";
import { _successfulCompleteVerificationStartDecorationType, _declarationRangeDecorationType, _declarationRangeEndlVerificationDecorationType, _declarationRangeStartVerificationDecorationType, _failedPartialVerificationDecorationType, _successfulCompleteVerificationDecorationType, _successfulCompleteVerificationEndDecorationType, _successfulPartialVerificationDecorationType } from "./toolbox/decorations";
import { FunctionRef, parseCompilerInfo, CompilerInfo } from "./types/compilerInfo";
import { CallContract, parseCallContracts } from "./types/encodingInfo"
import { PrustiMessageConsumer, Message, CargoMessage } from "./types/message"
import { MethodVerificationData } from "./types/methodVerificationData"
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

    // key: file name, method identifier
    private decoratorMaps: Map<string, Map<vscode.TextEditorDecorationType, vscode.Range[]>>;
    private lastUpdateTime: number;
    private blockUpdateInterval: number;
    private methodStatusChanged: Set<string>;
    private selectedMethods: Set<string> | undefined;
    // for procedureDefs we also have a boolean on whether these values
    // were already requested (for codelenses)
    private procedureDefs: Map<string, FunctionRef[]>;
    private functionCalls: Map<string, FunctionRef[]>;
    // key: pathKey
    private methodMap: Map<string, MethodVerificationData>;
    // key: rootpath, value: method defpath list 
    private crateMethods: Map<string, string[]>;
    private callContracts: Map<string, CallContract[]>;
    // key: file name
    private fileStateMap: Map<string, boolean>;
    private fileStateUpdateEmitter: EventEmitter;
    // we also have a reference to the VerificationManager so that we can tell it which files are
    // affected by the current verification so that other providers can clear these
    // I'm not super happy with this design choice, but for now it is what it is
    private verificationManager: VerificationManager;

    public constructor(verificationManager: VerificationManager, selectedMethods: Set<string> | undefined = undefined) {
        this.decoratorMaps = new Map();
        this.lastUpdateTime = Date.now();
        this.blockUpdateInterval = config.blockUpdateInterval();
        this.methodStatusChanged = new Set();
        this.selectedMethods = selectedMethods
        this.procedureDefs = new Map();
        this.functionCalls = new Map();
        this.methodMap = new Map();
        this.crateMethods = new Map();
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
        this.crateMethods.set(programPath, []);
        // TODO maybe clean out this.methodMap too?

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
        return (this.crateMethods.get(root) !== undefined)
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
                    arguments: [[pd.identifier]]
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
    public displayVerificationResults(): void {
        if (this.methodStatusChanged.size === 0) { return; }
        const activeEditor = vscode.window.activeTextEditor;
        const editorFilePath = activeEditor?.document.uri.fsPath;
        if (editorFilePath !== undefined) {
            const rootPath = util.getRootPath(editorFilePath);
            const decoratorMap: Map<vscode.TextEditorDecorationType, vscode.Range[]> = new Map();
            const methods = this.crateMethods.get(rootPath);
            methods?.forEach((methodName) => {
                const method = this.methodMap.get(pathKey(rootPath, methodName));
                if (method) {
                    if (method.filePath === editorFilePath) {
                        if (this.methodStatusChanged.has(methodName)) {
                            method.generateDecorators();
                        }
                        const [overallDecorator, blockDecorators] = method.getDecorators();

                        if (overallDecorator) {
                            decoratorMap.set(overallDecorator[0], [overallDecorator[1]]);
                        }
                        blockDecorators.forEach((ranges, dec) => {
                            const prevRanges = decoratorMap.get(dec);
                            if (prevRanges) {
                                decoratorMap.set(dec, prevRanges.concat(ranges));
                            } else {
                                decoratorMap.set(dec, ranges);
                            }
                        })
                    }
                } else {
                    util.log(`Couldn't find method named ${methodName} in ${rootPath}`);
                }
            });

            this.decoratorMaps.set(editorFilePath, decoratorMap);
            this.clearPreviousDecorators(editorFilePath);
            decoratorMap.forEach((ranges, dec) => {
                activeEditor?.setDecorations(dec, ranges);
            });
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
        const prev = this.decoratorMaps.get(filePath);
        if (prev !== undefined) {
            prev.forEach((_, dec: vscode.TextEditorDecorationType) => {
                vscode.window.activeTextEditor?.setDecorations(dec, []);
            });
        }
        this.decoratorMaps.set(
            filePath,
            new Map([
                [_successfulPartialVerificationDecorationType, []],
                [_successfulCompleteVerificationStartDecorationType, []],
                [_successfulCompleteVerificationDecorationType, []],
                [_successfulCompleteVerificationEndDecorationType, []],
                [_failedPartialVerificationDecorationType, []],
                [_declarationRangeStartVerificationDecorationType, []],
                [_declarationRangeDecorationType, []],
                [_declarationRangeEndlVerificationDecorationType, []]
            ])
        );
    }

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
     * A block is only updated once the next message for the same path arrives.
     * The last block of a path will receive both a `blockReachedMessage` and a
     * `pathProcessedMessage`. As such, the {@link BlockResult.result | result} of
     * a {@link BlockResult} is interpreted as the result of the preceeding message.
     */
    private updatePath(blockResult: BlockResult, rootPath: string): void {
        // util.log(`block result: ${JSON.stringify(blockResult)}`);
        // path ids are assumed to be unique across methods
        const key = pathKey(rootPath, blockResult.method);
        this.methodMap
            .get(key)
            ?.updatePartialResult(blockResult);
        this.methodStatusChanged.add(blockResult.method);
    }

    public addCompilerInfo(info: CompilerInfo, selectiveVerification: string | undefined): void {
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
        util.log(`selective verification: ${selectiveVerification}`);
        if (selectiveVerification) {
            this.selectedMethods = new Set(selectiveVerification.split(" "));
        }
        const methodNames: string[] = [];
        info.procedureDefs.forEach((pd: FunctionRef) => {
            const key: string = pathKey(rootPath, pd.identifier);
            let method = this.methodMap.get(key);
            if (this.selectedMethods && !this.selectedMethods.has(pd.identifier)) {
                // if not selected in a selective verification run, retain results and
                // immediately regenerate decorations for the current range
                method = new MethodVerificationData(pd, method);
                method.generateDecorators();
            } else {
                method = new MethodVerificationData(pd);
            }
            this.methodMap.set(key, method);
            methodNames.push(pd.identifier);
        });
        this.crateMethods.set(rootPath, methodNames);

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
                    this.addCompilerInfo(compilerInfo, vArgs.defPathArg.selectiveVerification);
                } else {
                    util.log("Invalid compilerInfo");
                }
                break;
            }
            case "ideVerificationResult": {
                const verificationResult = parseVerificationResult(msg.message);
                if (verificationResult !== undefined) {
                    const key = pathKey(rootPath, verificationResult?.methodName);
                    const method = this.methodMap.get(key);
                    if (method !== undefined) {
                        method.verificationResult = verificationResult;
                        util.log("Consumed ideVerificationResult");
                        this.methodStatusChanged.add(verificationResult.methodName);
                        this.displayVerificationResults();
                    } else {
                        util.log(`Invalid method name of ideVerificationResult (${verificationResult.methodName})`);
                    }
                } else {
                    util.log("Invalid ideVerificationResult");
                }
                break;
            }
            case "pathProcessedMessage":
            case "blockReachedMessage": {
              const blockResult = parseBlockMessage(msg, token);
              if (blockResult !== undefined){
                // mark current block of path as verified (mark block as verified overall if there hasn't been a failures yet)
                // and advance current block of path to blockResult.span (should be span of a label/block)
                this.updatePath(blockResult, rootPath);
                // TODO somehow detect if there has not been a message for some time and force an update
                // currently the current block marker may be misleading due to the interval below.
                const time = Date.now()
                if (time - this.lastUpdateTime > this.blockUpdateInterval) {
                    // there should always be an ideVerificationResult at the end which calls displayVerificationResults
                    // unconditionally, so there is no need to make sure the last of these messages is displayed.
                    this.displayVerificationResults();
                }
                util.log(`Consumed ${token}`);
              } else {
                util.log(`Invalid ${token}: ${msg.message}`);
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
