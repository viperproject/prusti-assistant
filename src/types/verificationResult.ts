export interface VerificationResult {
    //this is the method name
    item_name: string,
    success: boolean,
    time_ms: number,
    cached: boolean,
}

export function parseVerificationResult(line: string): VerificationResult | undefined {
    const token = "ideVerificationResult";
    if (!line.startsWith(token)) {
        return undefined;
    }
    return JSON.parse(line.substring(token.length)) as VerificationResult;
}
