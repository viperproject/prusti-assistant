import * as util from "./../util"
import * as vscode from "vscode";
import { FunctionRef } from "./compilerInfo";
import { VerificationResult } from "./verificationResult";
import { CompilerInfo} from "./compilerInfo"
import { CallContracts } from "./encodingInfo";
import * as display from "./display"


// Information from the compiler that can be obtained without invoking verification
export class InfoCollection {
    // for proc_defs we also have a boolean on whether these values 
    // were already requested (for codelenses)
    procedureDefs: Map<string, FunctionRef[]>;
    functionCalls: Map<string, FunctionRef[]>;
    fileStateMap: Map<string, boolean>;
    verificationInfo: Map<string, VerificationResult[]>;
    rangeMap: Map<string, [vscode.Range, string]>; 
    projects: util.ProjectList;
    decorations: Map<string, vscode.TextEditorDecorationType[]>;
    callContracts: Map<string, CallContracts[]>;

    
    constructor() {
        this.procedureDefs = new Map();
        this.functionCalls = new Map();
        this.fileStateMap = new Map();
        this.verificationInfo = new Map();
        this.rangeMap = new Map(); 
        this.projects = new util.ProjectList([]);
        this.decorations = new Map();
        this.callContracts = new Map();
    }
    
    public addCompilerInfo(info: CompilerInfo): void{
        if (info.queriedSource) {
            // yet to be formatted:
            vscode.env.clipboard.writeText(info.queriedSource);
            util.userInfoPopup("Template for extern spec. is now on your Clipboard.");
        }
    
        info.distinctFiles.forEach((fileName) => {
            // mark each file's information as "not read yet"
            this.fileStateMap.set(fileName, false);
            // and then notify CodeLensHandlers of the update
            display.updateEmitter.emit('updated' + fileName);
        })
        // create all sorts of data structures that will be practical:
        let rootPath = info.rootPath;
        util.log(`Adding CompilerInfo to path: ${rootPath}`);
        this.procedureDefs.set(rootPath, info.procedureDefs);
        this.functionCalls.set(rootPath, info.functionCalls);

        info.procedureDefs.forEach((pd: FunctionRef) => {
            let key: string = this.pathKey(rootPath, pd.identifier);
            this.rangeMap.set(key, [pd.range, pd.fileName]);
        });

        display.force_codelens_update();
    }

    public addContracts(callContracts: CallContracts[], root: string): void {
        // so far encoding info only consists of CallContracts
        this.callContracts.set(root, callContracts);
    }


    /** Either returns the path to the root of the crate containing
    * the file (at filePath), or just filePath itself, if it's 
    * a standalone file
    */
    public getRootPath(filePath: string): string {
        var res;
        let parent = this.projects.getParent(filePath);
        if (parent !== undefined) {
            res = parent.path + "/";
        } else {
            res = filePath;
        }
        return res;
    }

    pathKey(rootPath: string, methodIdent: string): string {
        return rootPath + ":" + methodIdent;
    }

    public getLocation(rootPath: string, methodIdent: string): [vscode.Range, string] | undefined {
        return this.rangeMap.get(this.pathKey(rootPath, methodIdent));
    }
}

export const infoCollection = new InfoCollection();

