import * as assert from "assert";
import * as vscode from "vscode";
import * as path from "path";
import * as glob from "glob";
import * as fs from "fs-extra";
import * as os from "os";
import { expect } from "chai";
import * as config from "../config";
import * as state from "../state";
import * as extension from "../extension"

/**
 * Get the path of the workspace.
 *
 * @returns The path of the workspace.
 */
function workspacePath(): string {
    assert.ok(vscode.workspace.workspaceFolders?.length);
    return vscode.workspace.workspaceFolders[0].uri.fsPath;
}

/**
 * Convert a URI to a relative workspace path with forward slashes.
 *
 * @param uri The URI to convert.
 * @returns The computed relative path.
 */
function asRelativeWorkspacePath(target: vscode.Uri): string {
    // Resolve symlinks (e.g., in MacOS, `/var` is a symlink to `/private/var`).
    // We do this manually becase `vscode.workspace.asRelativePath` does not resolve symlinks.
    try {
        const normalizedTarget = fs.realpathSync(target.fsPath);
        const normalizedWorkspace = fs.realpathSync(workspacePath());
        return path.relative(normalizedWorkspace, normalizedTarget).replace(/\\/g, "/");
    } catch (error) {
        // If realpathSync fails (e.g., file doesn't exist or is outside workspace),
        // fall back to using paths as-is
        console.log(`Warning: Could not resolve path ${target.fsPath}, using as-is`);
        // On Windows, URIs may have forward slashes. Convert to native path format first.
        let targetPath = target.fsPath;
        // Replace forward slashes with the path separator for the platform
        if (path.sep === '\\') {
            targetPath = targetPath.replace(/\//g, '\\');
        }
        return path.relative(workspacePath(), targetPath).replace(/\\/g, "/");
    }
}

/**
 * Normalize a path for flexible comparison by extracting the last N components.
 * This allows comparing paths that may have different prefixes (absolute vs relative)
 * but refer to the same file.
 *
 * @param uri The URI to normalize.
 * @param componentCount Number of path components to extract from the end.
 * @returns The normalized path suffix.
 */
function normalizePathForComparison(uri: string, componentCount: number = 5): string {
    const normalizedPath = uri.replace(/\\/g, "/");
    const parts = normalizedPath.split("/").filter(p => p.length > 0);
    return parts.slice(-componentCount).join("/");
}

/**
 * Normalize diagnostic URIs for cross-platform comparison.
 * This normalizes all URI paths to use only the last N components,
 * allowing comparison of diagnostics that may have different absolute/relative paths.
 *
 * @param diagnostic The diagnostic to normalize.
 * @returns A new diagnostic with normalized URIs.
 */
function normalizeDiagnostic(diagnostic: Diagnostic): Diagnostic {
    const normalized: Diagnostic = {
        ...diagnostic,
        uri: normalizePathForComparison(diagnostic.uri),
    };

    if (diagnostic.relatedInformation) {
        normalized.relatedInformation = diagnostic.relatedInformation.map(info => ({
            ...info,
            location: {
                ...info.location,
                uri: normalizePathForComparison(info.location.uri),
            },
        }));
    }

    return normalized;
}

/**
 * Open a file in the IDE
 * @param filePath The file to open.
 * @returns A promise with the opened document.
 */
function openFile(filePath: string): Promise<vscode.TextDocument> {
    return new Promise((resolve, reject) => {
        console.log("Open " + filePath);
        vscode.workspace.openTextDocument(filePath).then(document => {
            vscode.window.showTextDocument(document).then(() => {
                resolve(document);
            }).then(undefined, reject);
        }).then(undefined, reject);
    });
}

/**
 * Evaluate the filter used in the `.rs.json` expected diagnostics.
 * @param filter The filter dictionary.
 * @param name The name of the filter.
 * @returns True if the filter is fully satisfied, otherwise false.
 */
function evaluateFilter(filter: [string: string], name: string): boolean {
    for (const [key, value] of Object.entries(filter)) {
        let actualValue: string
        if (key == "os") {
            actualValue = os.platform();
        } else {
            actualValue = config.config().get(key, "undefined");
        }
        if (value != actualValue) {
            console.log(
                `Filter ${name} requires '${key}' to be '${value}', but the actual value is ` +
                `'${actualValue}'.`
            );
            return false;
        }
    }
    console.log(`Filter ${name} passed.`);
    return true;
}

// JSON-like types used to normalize the diagnostics
type Position = {
    line: number,
    character: number
}

type Range = {
    start: Position,
    end: Position
}

type RelatedInformation = {
    location: {
        uri: string,
        range: Range,
    },
    message: string
}

type Diagnostic = {
    // This path is relative to VSCode's workspace
    uri: string,
    range: Range,
    severity: number,
    message: string,
    relatedInformation?: RelatedInformation[],
}

function rangeToPlainObject(range: vscode.Range): Range {
    return {
        start: {
            line: range.start.line,
            character: range.start.character
        },
        end: {
            line: range.end.line,
            character: range.end.character
        }
    };
}

/**
 * Normalize a diagnostic, converting it to a plain object.
 *
 * @param uri The URI of the file containing the diagnostic.
 * @param diagnostic The diagnostic to convert.
 * @returns The normalized diagnostic.
 */
function diagnosticToPlainObject(uri: vscode.Uri, diagnostic: vscode.Diagnostic): Diagnostic {
    const plainDiagnostic: Diagnostic = {
        uri: asRelativeWorkspacePath(uri),
        range: rangeToPlainObject(diagnostic.range),
        severity: diagnostic.severity,
        message: diagnostic.message,
    };
    if (diagnostic.relatedInformation) {
        plainDiagnostic.relatedInformation = diagnostic.relatedInformation.map((relatedInfo) => {
            return {
                location: {
                    uri: asRelativeWorkspacePath(relatedInfo.location.uri),
                    range: rangeToPlainObject(relatedInfo.location.range)
                },
                message: relatedInfo.message,
            };
        });
    }
    return plainDiagnostic;
}

// Constants used in the tests
const PROJECT_ROOT = path.join(__dirname, "..", "..");
const SCENARIOS_ROOT = path.join(PROJECT_ROOT, "src", "test", "scenarios");
const SCENARIO = process.env.SCENARIO;
assert(SCENARIO, "Cannot run tests because the SCENARIO environment variable is empty.")
const SCENARIO_PATH = path.join(SCENARIOS_ROOT, SCENARIO);
const SHARED_SCENARIO_PATH = path.join(SCENARIOS_ROOT, "shared");
console.log("Scenario path:", SCENARIO_PATH)

describe("Extension", () => {
    before(async () => {
        // Prepare the workspace
        console.log(`Preparing workspace of scenario '${SCENARIO}'`);
        for (const topFolderPath of [SCENARIO_PATH, SHARED_SCENARIO_PATH]) {
            for (const scenarioFolder of ["crates", "programs"]) {
                const srcPath = path.join(topFolderPath, scenarioFolder);
                const dstPath = path.join(workspacePath(), scenarioFolder);
                if (!await fs.pathExists(srcPath)) {
                    continue;
                }
                const srcFiles = await fs.readdir(srcPath);
                for (const srcFileName of srcFiles) {
                    const srcFile = path.join(srcPath, srcFileName);
                    const dstFile = path.join(dstPath, srcFileName);
                    await vscode.workspace.fs.copy(vscode.Uri.file(srcFile), vscode.Uri.file(dstFile));
                }
            }
        }
        // Wait until the extension is active
        await openFile(path.join(workspacePath(), "programs", "assert_true.rs"));
        await state.waitExtensionActivation();
    });

    after(async () => {
        // HACK: It seems that `deactivate` is not called when using the test
        //   suite. So, we manually call the deactivate() function.
        console.log("Tear down test suite");
        await extension.deactivate();
    })

    it(`scenario ${SCENARIO} can update Prusti`, async () => {
        // Tests are run serially, so nothing will run & break while we're updating
        await openFile(path.join(workspacePath(), "programs", "assert_true.rs"));
        await vscode.commands.executeCommand("prusti-assistant.update");
    });

    // Generate a test for every Rust program with expected diagnostics in the test suite.
    // Track both the program path and its source directory
    type ProgramInfo = { program: string; sourceDir: string };
    const programs: Array<ProgramInfo> = [
        SCENARIO_PATH,
        SHARED_SCENARIO_PATH
    ].flatMap(dir =>
        glob.sync("**/*.rs.json", { cwd: dir }).map(filePath => ({
            program: filePath.replace(/\.json$/, ""),
            sourceDir: dir
        }))
    );
    console.log(`Creating tests for ${programs.length} programs: ${programs.map(p => p.program)}`);
    assert.ok(programs.length >= 3, `There are not enough programs to test (${programs.length})`);
    programs.forEach(({ program, sourceDir }) => {
        it(`scenario ${SCENARIO} reports expected diagnostics on ${program}`, async () => {
            // Verify the program
            const programPath = path.join(workspacePath(), program);
            await openFile(programPath);
            await vscode.commands.executeCommand("prusti-assistant.verify");

            // Collect and normalize the diagnostics
            const plainDiagnostics = vscode.languages.getDiagnostics().flatMap(pair => {
                const [uri, diagnostics] = pair;
                return diagnostics.map(diagnostic => diagnosticToPlainObject(uri, diagnostic));
            });

            // Check if we should update snapshots instead of comparing
            const updateSnapshots = process.env.UPDATE_SNAPSHOTS === "true";
            // For reading, use the temp workspace path
            const tempJsonPath = programPath + ".json";
            // For writing snapshots, use the original source directory
            const sourceJsonPath = path.join(sourceDir, program + ".json");

            if (updateSnapshots) {
                console.log(`Updating snapshot: ${sourceJsonPath}`);
                console.log("Actual: " + JSON.stringify(plainDiagnostics, null, 4));
                await fs.writeFile(sourceJsonPath, JSON.stringify(plainDiagnostics, null, 4) + "\n", "utf-8");
                console.log(`Snapshot updated successfully.`);
            } else {
                // Load the expected diagnostics. A single JSON file can contain multiple alternatives.
                const expectedData = await fs.readFile(tempJsonPath, "utf-8");
                type MultiDiagnostics = [
                    { filter?: [string: string], diagnostics: Diagnostic[] }
                ];
                const expected = JSON.parse(expectedData) as Diagnostic[] | MultiDiagnostics;
                let expectedMultiDiagnostics: MultiDiagnostics;
                if (!expected.length || !("diagnostics" in expected[0])) {
                    expectedMultiDiagnostics = [
                        { "diagnostics": expected as Diagnostic[] }
                    ];
                } else {
                    expectedMultiDiagnostics = expected as MultiDiagnostics;
                }

                // Select the expected diagnostics to be used for the current environment
                let expectedDiagnostics = expectedMultiDiagnostics.find((alternative, index) => {
                    if (!alternative.filter) {
                        console.log(
                            `Find expected diagnostics: using default ` +
                            `alternative ${index}.`
                        );
                        return true;
                    }
                    return evaluateFilter(alternative.filter, index.toString());
                });
                if (!expectedDiagnostics) {
                    console.log(
                        "Find expected diagnostics: found no matching alternative."
                    );
                    expectedDiagnostics = {
                        "diagnostics": [] as unknown as Diagnostic[]
                    };
                }
                // Normalize URIs in both actual and expected diagnostics for cross-platform comparison
                const normalizedActual = plainDiagnostics.map(normalizeDiagnostic);
                const normalizedExpected = expectedDiagnostics.diagnostics.map(normalizeDiagnostic);

                console.log("Expected: " + JSON.stringify(normalizedExpected, null, 4));
                console.log("Actual: " + JSON.stringify(normalizedActual, null, 4));

                expect(normalizedActual).to.deep.equal(normalizedExpected);
            }
        });
    });
});
