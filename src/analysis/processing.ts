import * as util from "./../util";
import { FunctionRef, parseCompilerInfo } from "./compilerInfo"
import { parseVerificationResult } from "./verificationResult"
import * as display from "./display";
import { infoCollection } from "./infoCollection";




export function process_output(rootPath: string, output: string, isCrate: boolean) {

    let compilerInfo = null;
    compilerInfo = parseCompilerInfo(output, rootPath, isCrate);
    if ( compilerInfo ){
        infoCollection.addCompilerInfo(compilerInfo);
    }

    infoCollection.verificationInfo.set(rootPath, parseVerificationResult(output, isCrate, rootPath));

    util.log("\n\n\nrootPath: " + rootPath);
    display.displayResults()

}


