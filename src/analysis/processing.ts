import * as util from "./../util";
import { FunctionRef, parseCompilerInfo } from "./compilerInfo"
import { parseVerificationResult } from "./verificationResult"
import * as display from "./display";
import { infoCollection } from "./infoCollection";
import { parseCallContracts } from "./encodingInfo";




export function process_output(rootPath: string, output: string, isCrate: boolean) {

    let compilerInfo = parseCompilerInfo(output, rootPath, isCrate);
    if ( compilerInfo ) {
        infoCollection.addCompilerInfo(compilerInfo);
    }

    let callContracts = parseCallContracts(output, rootPath, isCrate);
    if ( callContracts ) {
        infoCollection.addContracts(callContracts, rootPath);
    }

    infoCollection.verificationInfo.set(rootPath, parseVerificationResult(output, isCrate, rootPath));

    display.displayResults()

}


