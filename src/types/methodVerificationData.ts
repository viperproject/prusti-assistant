
import { assert } from "console";
import { DecorationType, successfulVerificationDecorationType, successfulVerificationTextDecorationType, failedVerificationDecorationType, failedVerificationTextDecorationType} from "../toolbox/decorations";
import * as vscode from "vscode";
import * as util from "../util";
import * as config from "../config";
import { VerificationResult } from "./verificationResult";
import { FunctionRef } from "./compilerInfo";
import { BlockResult } from "./blockMessage";

type RelativeRange = [number, number];

/**
 * Bitwise NOT for bigint, treating it as unsigned of `bitLength` bits.
 */
function invertBigint(x: bigint, bitLength: bigint): bigint {
    return (~x) & ((BigInt(1) << bitLength) - BigInt(1));
}

/**
 * @return a bitmask covering the given range
 */
function rangeToMask(range: RelativeRange): bigint {
    let mask = (BigInt(1) << BigInt(range[1] + 1)) - BigInt(1)
    mask = mask ^ ((BigInt(1) << BigInt(range[0])) - BigInt(1))
    return mask;
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
    ranges.push([currentRangeStart, bitString.length - 2]);

    const ranges0 = [];
    const ranges1 = [];
    const firstBit = bitString[1] === '0' ? 0 : 1;
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
    hash: string | undefined;
    range: vscode.Range;
    stale: boolean;
    // there may be several paths being traversed through this method
    // at a time. this remembers what the current block is for a path id.
    // it only remembers the range, as the result is carried by the next
    // block on the path. a mapping will be deleted if the path is processed.
    pathTraversal: Map<number, RelativeRange>;
    // per line flags. each bit represents the presence of a result or failure
    // on the respective line (least significatn bit = first line)
    hasResult: bigint;
    failures: bigint;
    // lines of code (including delimiters)
    loc: number;
    // overall result
    verificationResult: VerificationResult | undefined;
    decorations: Map<DecorationType, vscode.Range[]>;

    public constructor(fn: FunctionRef, hash: string | undefined, previous: MethodVerificationData | undefined = undefined) {
        this.name = fn.identifier;
        this.filePath = fn.fileName;
        this.hash = hash;
        this.range = fn.range;
        this.stale = false;
        this.decorations = new Map();
        this.loc = this.end() - this.start() + 1;
        this.pathTraversal = new Map();
        this.failures = BigInt(0);
        this.hasResult = BigInt(0);
        if (previous != undefined && previous.hasResult != BigInt(0)) {
            assert(fn.identifier === previous.name, `name mismatch between method structs: ${fn.identifier} - ${previous.name}`);
            assert(fn.fileName === previous.filePath, `file name mismatch between method structs: ${fn.fileName} - ${previous.filePath}`);
            // if the hash changes we assume that the prior results are no longer valid.
            if (this.hash === undefined || previous.hash === undefined || this.hash !== previous.hash) {
                util.log(`Method hash changed for ${fn.identifier}. Wiping results.`);
            } else {
                this.stale = true;
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
     * We consider methods that span less than 4 lines (including declaration &
     * body-surrounding braces) short. Short methods do not display per-block results,
     * but will have the regular tick or cross instead.
     */
    public short(): boolean {
        return this.loc < 4
    }

    public resetResults(): void {
        this.failures = BigInt(0);
        this.hasResult = BigInt(0);
        this.verificationResult = undefined;
        this.decorations = new Map();
    }

    private relRangeFromRange(range: vscode.Range): RelativeRange {
        return [range.start.line - this.start(), range.end.line - this.start()]
    }

    /**
     * The range of the block must be within the method range (or be a `pathProcessedMessage`).
     * The entire range of the method will be marked according to `result`.
     * That is, if a part of it was marked as failure before, it will never be updated to success again.
     */
    public updatePartialResult(block: BlockResult): void {
        assert(
            block.pathProcessesd || this.range.contains(block.range),
            `block range not in method (${this.name}) ranges:\n${JSON.stringify(block.range)} </: ${JSON.stringify(this.range)}`
        );

        const previousPathResult = this.pathTraversal.get(block.pathId);
        if (previousPathResult !== undefined) {
            const mask = rangeToMask(previousPathResult)
            if (!block.result) {
                this.failures = this.failures | mask;
            }
            this.hasResult = this.hasResult | mask;
        }
        if (block.pathProcessesd) {
            this.pathTraversal.delete(block.pathId)
        } else {
            // if this is the first block of a path, no need to actually update the results yet
            const relRange = this.relRangeFromRange(block.range);
            this.pathTraversal.set(block.pathId, relRange);
        }
    }

    /**
     * @returns a pair of the range mask of current blocks and its inversion
     */
    private getCurrentBlockMasks(): [bigint, bigint] {
        let mask = BigInt(0);
        this.pathTraversal.forEach((range) => {
            const cur = rangeToMask(range)
            mask = cur | mask;
        })
        return [mask, invertBigint(mask, BigInt(this.loc))];
    }

    private makeOverallVerificationDecorator(): vscode.TextEditorDecorationType {
        if (this.verificationResult!.success) {
            if (this.short() || !config.generateBlockMessages()) {
                return successfulVerificationDecorationType(
                    this.verificationResult!.time_ms,
                    this.verificationResult!.cached,
                    this.stale
                );
            } else {
                return successfulVerificationTextDecorationType(
                    this.verificationResult!.time_ms,
                    this.verificationResult!.cached,
                    this.stale
                );
            }
        } else {
            if (this.short() || !config.generateBlockMessages()) {
                return failedVerificationDecorationType(
                    this.verificationResult!.time_ms,
                    this.verificationResult!.cached,
                    this.stale
                );
            } else {
                return failedVerificationTextDecorationType(
                    this.verificationResult!.time_ms,
                    this.verificationResult!.cached,
                    this.stale
                );
            }
        }
    }

    /**
     * Requires that {@link generateDecorators} has been called beforehand to return block based decorators.
     * @returns The first tuple element is and overall result decorator and it's range, or undefined if no overall
     * result is available. The second element is a map containing ranges for block based decorators. 
     */
    public getDecorators(
    ):  [
            [vscode.TextEditorDecorationType, vscode.Range] | undefined,
            Map<DecorationType, vscode.Range[]>
        ]
    {
        if (this.verificationResult) {
            const range_line = util.fullLineRange(this.range);
            return [[this.makeOverallVerificationDecorator(), range_line], this.decorations];
        }
        return [undefined, this.decorations];
    }

    /**
     * Generates and store block based decorators based on the information already contained in `this`.
     * Does not return them. To retrieve them, call {@link getDecorators} instead.
     */
    public generateDecorators(): void {
        // short methods (1-3 lines including braces) just get the regular overall decorators
        if (config.generateBlockMessages() && !this.short()) {
            const overallSuccess = this.verificationResult?.success ?? false;
            this.decorations = new Map([
                [DecorationType.SUCCESS_TOP, []],
                [DecorationType.SUCCESS, []],
                [DecorationType.SUCCESS_BOT, []],
                [DecorationType.SUCCESS_PARTIAL, []],
                [DecorationType.FAIL_PARTIAL, []],
                [DecorationType.DECL_TOP, []],
                [DecorationType.DECL, []],
                [DecorationType.DECL_BOT, []],
                [DecorationType.CURRENT_BLOCK, []]
            ]);

            const rangeStart = new vscode.Range(this.range.start, this.range.start);
            const rangeEnd = new vscode.Range(this.range.end, this.range.end);
            if (overallSuccess) {
                // green bar over whole span
                const rangeBody = new vscode.Range(this.range.start.translate(1), this.range.end.translate(-1));
                this.decorations.get(DecorationType.SUCCESS_TOP)!.push(rangeStart);
                this.decorations.get(DecorationType.SUCCESS)!.push(rangeBody);
                this.decorations.get(DecorationType.SUCCESS_BOT)!.push(rangeEnd);
            }
            else if (this.hasResult) {
                this.decorations.get(DecorationType.DECL_TOP)!.push(rangeStart);
                this.decorations.get(DecorationType.DECL_BOT)!.push(rangeEnd);

                const [currentBlockMask, invCurrentBlockMask] = this.getCurrentBlockMasks();
                const noResultRanges = maskAsRanges(this.hasResult | currentBlockMask, this.loc)[0];
                const failureRanges = maskAsRanges(this.failures & invCurrentBlockMask, this.loc)[1];
                const successRanges = maskAsRanges((this.hasResult ^ this.failures) & invCurrentBlockMask, this.loc)[1];

                const storeDecoratorRanges = (range: [number, number], dec: DecorationType) => {
                    const vscodeRange = new vscode.Range(range[0] + this.start(), 0, range[1] + this.start(), 0);
                    this.decorations.get(dec)!.push(vscodeRange);
                };
                noResultRanges.forEach((range) => storeDecoratorRanges(range, DecorationType.DECL));
                failureRanges.forEach((range) => storeDecoratorRanges(range, DecorationType.FAIL_PARTIAL));
                successRanges.forEach((range) => storeDecoratorRanges(range, DecorationType.SUCCESS_PARTIAL));
                this.pathTraversal.forEach((range) => storeDecoratorRanges(range, DecorationType.CURRENT_BLOCK));
            } else {
                util.log(`The method ${this.name} has no partial results.`);
            }
        }
    }
}