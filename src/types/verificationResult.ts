interface VerificationResultRaw {
    item_name: string,
    success: boolean,
    time_ms: number,
    cached: boolean,
}

export interface VerificationResult {
    methodName: string,
    success: boolean,
    time_ms: number,
    cached: boolean,
}

// currently the value given for itemName is "filename_methodpath"
// should this be done in rust?
function splitName(name: string) : string {
    // position of the underscore
    const position = name.search(".rs_") + 3;
    // const filename = name.substring(0, position);
    const methodPath = name.substring(position+1);
    return methodPath;
}

function transformVerificationResult(rawRes: VerificationResultRaw) : VerificationResult {
    const methodPath = splitName(rawRes.item_name);
    // we realized this fileName is not useful, for crates it's always main.rs
    const res = {
        methodName: methodPath,
        success: rawRes.success,
        time_ms: rawRes.time_ms,
        cached: rawRes.cached,
    };
    return res;
}

export function parseVerificationResult(line: string): VerificationResult | undefined {
    const token = "ideVerificationResult";
    if (!line.startsWith(token)) {
        return undefined;
    }
    const rawResult = JSON.parse(line.substring(token.length)) as VerificationResultRaw;
    return transformVerificationResult(rawResult);
}
