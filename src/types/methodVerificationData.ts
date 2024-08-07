
import { assert } from "console";
import { _successfulCompleteVerificationStartDecorationType, _declarationRangeDecorationType, _declarationRangeEndlVerificationDecorationType, _declarationRangeStartVerificationDecorationType, _failedPartialVerificationDecorationType, failedVerificationDecorationType, failedVerificationTextDecorationType, _successfulCompleteVerificationDecorationType, _successfulCompleteVerificationEndDecorationType, _successfulPartialVerificationDecorationType, successfulVerificationDecorationType, successfulVerificationTextDecorationType } from "../toolbox/decorations";
import * as vscode from "vscode";
import * as util from "../util";
import * as config from "../config";
import { VerificationResult } from "./verificationResult";
import { FunctionRef } from "./compilerInfo";

type RelativeRange = [number, number];

/**
 * Bitwise NOT for bigint, treating it as unsigned of `bitLength` bits.
 */
function invertBigint(x: bigint, bitLength: bigint): bigint {
    return (~x) & ((BigInt(1) << bitLength) - BigInt(1));
}

/**
 * Conversts a bitmask into two arrays of number tuples. Each tuple represents a line range,
 * relative to the start of the method's starting line. The first array is composed of ranges
 * covering the bit indices where the mask is 0, the second one where it is 1.
 * @param bitLength masks shorter than the `bitLength` are 0-padded at the beginning.
 */
function maskAsRanges(
    mask: bigint,
    bitLength: number,
): [RelativeRange[], RelativeRange[]] {
    // need to reverse the string due to endianness
    const bitString = mask
        .toString(2)
        .split('')
        .reverse()
        .join('')
        .padEnd(bitLength, '0');
    const ranges: RelativeRange[] = [];
    
    let currentRangeStart = 1;
    let currentBit = bitString[1];

    // first and last bits are always skipped because they have special
    // decorators anyway.
    for (let i = 2; i < bitString.length - 1; i++) {
            if (bitString[i] !== currentBit) {
                ranges.push([currentRangeStart, i - 1]);
                currentRangeStart = i;
                currentBit = bitString[i]
            }
    }
    // this access should be safe since this method should only be called when
    // the method LoC is greater than 2
    ranges.push([currentRangeStart, bitString.length - 1]);

    const ranges0 = [];
    const ranges1 = [];
    const firstBit = bitString[0] === '0' ? 0 : 1;
    for (let i = 0; i < ranges.length; i++) {
        if (i % 2 === firstBit) {
            ranges0.push(ranges[i]);
        } else {
            ranges1.push(ranges[i]);
        }
    }

    return [ ranges0, ranges1 ];
}

/**
 * A collection of data on an individual method.
 * Used to track and selectively wipe decorators.
 */
export class MethodVerificationData {
    name: string;
    filePath: string;
    range: vscode.Range;
    length: number;
    // per line flags
    hasResult: bigint;
    failures: bigint;
    bitLength: number;
    // overall result
    verificationResult: VerificationResult | undefined;
    verificationResultDecorator: [vscode.TextEditorDecorationType, vscode.Range] | undefined;
    decorations: Map<vscode.TextEditorDecorationType, vscode.Range[]>;

    public constructor(fn: FunctionRef, previous: MethodVerificationData | undefined = undefined) {
        this.name = fn.identifier;
        this.filePath = fn.fileName;
        this.range = fn.range;
        this.length = this.range.end.line - this.range.start.line;
        this.decorations = new Map();
        this.bitLength = this.end() - this.start();
        if (!previous) {
            this.failures = BigInt(0);
            this.hasResult = BigInt(0);
        } else {
            assert(fn.identifier === previous.name, `name mismatch between method structs: ${fn.identifier} - ${previous.name}`);
            assert(fn.fileName === previous.filePath, `file name mismatch between method structs: ${fn.fileName} - ${previous.filePath}`);
            // if the LoC changes we assume that the prior results are no longer valid.
            if (this.length !== previous.length) {
                util.log(`Method LoC changed for ${fn.identifier} (${this.length} -> ${previous.length}). Wiping decorators.`);
                this.failures = BigInt(0);
                this.hasResult = BigInt(0);
            } else {
                this.verificationResult = previous.verificationResult;
                this.failures = previous.failures;
                this.hasResult = previous.hasResult;
            }
        }
    }

    public start(): number {
        return this.range.start.line
    }

    public end(): number {
        return this.range.end.line
    }

    /**
     * We consider methods that span less than 3 lines (including declaration &
     * body-surrounding braces) short. Short methods do not display per-block results,
     * but will have the regular tick or cross instead.
     */
    public short(): boolean {
        return this.length < 3
    }

    public resetResults(): void {
        this.failures = BigInt(0);
        this.hasResult = BigInt(0);
        this.verificationResult = undefined;
        this.decorations = new Map();
        this.verificationResultDecorator = undefined;
    }

    /**
     * @param range Must be withint the method range. The entire range of the will be marked according to
     * `result`. That is, if a part of it was marked as failure before, it will never be updated to success
     * again.
     * @param result true: Success, false: Failure
     */
    public updatePartialResult(range: vscode.Range, result: boolean): void {
        assert(this.range.contains(range));
        // vscode.Range has 0-based indices, so we add 1 to the end, so the bit shifts
        // can also map 0
        const start = range.start.line - this.start();
        const end = range.end.line - this.start() + 1;
        let mask = (BigInt(1) << BigInt(end)) - BigInt(1)
        mask = mask ^ ((BigInt(1) << BigInt(start)) - BigInt(1))
        if (!result){
            this.failures = this.failures | mask;
        }
        this.hasResult = this.hasResult | mask;
    }

    private makeOverallVerificationDecorator(): vscode.TextEditorDecorationType {
        if (this.verificationResult!.success) {
            if (this.short() || !config.generateBlockMessages()) {
                return successfulVerificationDecorationType(
                    this.verificationResult!.time_ms,
                    this.verificationResult!.cached
                );
            } else {
                return successfulVerificationTextDecorationType(
                    this.verificationResult!.time_ms,
                    this.verificationResult!.cached
                );
            }
        } else {
            if (this.short() || !config.generateBlockMessages()) {
                return failedVerificationDecorationType(
                    this.verificationResult!.time_ms,
                    this.verificationResult!.cached
                );
            } else {
                return failedVerificationTextDecorationType(
                    this.verificationResult!.time_ms,
                    this.verificationResult!.cached
                );
            }
        }
    }

    /**
     * Requires that {@link generateDecorators} has been called beforehand (will return `[undefined, {}]` otherwise).
     * @returns The first tuple element is and overall result decorator and it's range, or undefined if no overall
     * result is available. The second element is a map containing ranges for block based decorators. 
     */
    public getDecorators(
    ):  [
        [vscode.TextEditorDecorationType, vscode.Range] | undefined,
        Map<vscode.TextEditorDecorationType, vscode.Range[]>
        ]
    {
        return [this.verificationResultDecorator, this.decorations];
    }

    /**
     * Generates and store decorators based on the information already contained in `this`.
     * Does not return them. To retrieve them, call {@link getDecorators} instead.
     */
    public generateDecorators(): void {
        let overallSuccess = false;
        const range_line = util.fullLineRange(this.range);
        if (this.verificationResult) {
            this.verificationResultDecorator = [this.makeOverallVerificationDecorator(), range_line];
            overallSuccess = this.verificationResult.success;
        }
        

        // short methods (1-2 lines including braces) just get the regular overall decorators
        if (config.generateBlockMessages() && !this.short()) {
            this.decorations = new Map([
                [_successfulCompleteVerificationStartDecorationType, []],
                [_successfulCompleteVerificationDecorationType, []],
                [_successfulCompleteVerificationEndDecorationType, []],
                [_successfulPartialVerificationDecorationType, []],
                [_failedPartialVerificationDecorationType, []],
                [_declarationRangeStartVerificationDecorationType, []],
                [_declarationRangeDecorationType, []],
                [_declarationRangeEndlVerificationDecorationType, []]
            ]);

            const rangeStart = new vscode.Range(this.range.start, this.range.start);
            const rangeEnd = new vscode.Range(this.range.end, this.range.end);
            if (overallSuccess) {
                // green bar over whole span
                const rangeBody = new vscode.Range(this.range.start.translate(1), this.range.end.translate(-1));
                this.decorations.get(_successfulCompleteVerificationStartDecorationType)!.push(rangeStart);
                this.decorations.get(_successfulCompleteVerificationDecorationType)!.push(rangeBody);
                this.decorations.get(_successfulCompleteVerificationEndDecorationType)!.push(rangeEnd);
            }
            else if (this.hasResult) {
                this.decorations.get(_declarationRangeStartVerificationDecorationType)!.push(rangeStart);
                this.decorations.get(_declarationRangeEndlVerificationDecorationType)!.push(rangeEnd);

                const noResultRanges = maskAsRanges(invertBigint(this.hasResult, BigInt(this.bitLength)), this.bitLength)[0];
                const failureRanges = maskAsRanges(this.failures, this.bitLength)[1];
                const successRanges = maskAsRanges(this.hasResult ^ this.failures, this.bitLength)[0];

                const storeDecoratorRanges = (range: [number, number], dec: vscode.TextEditorDecorationType) => {
                    const vscodeRange = new vscode.Range(range[0] + this.start(), 0, range[1] + this.start(), 0);
                    this.decorations.get(dec)!.push(vscodeRange);
                };
                noResultRanges.forEach((range) => storeDecoratorRanges(range, _declarationRangeDecorationType));
                failureRanges.forEach((range) => storeDecoratorRanges(range, _failedPartialVerificationDecorationType));
                successRanges.forEach((range) => storeDecoratorRanges(range, _successfulPartialVerificationDecorationType));
            } else {
                util.log(`The method ${this.name} has no partial results.`);
            }
        }
    }
}