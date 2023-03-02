import * as assert from "assert";
import * as vscode from "vscode";
import * as path from "path";
import * as glob from "glob";
import { expect } from "chai";
import * as fs from "fs-extra";
import * as os from "os";
import * as config from "../config";
import * as state from "../state";
import * as extension from "../extension"

function workspacePath(): string {
    assert.ok(vscode.workspace.workspaceFolders?.length);
    return vscode.workspace.workspaceFolders[0].uri.fsPath;
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
 * Evaluate tje filter used in the `.rs.json` expected diagnostics.
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

// Types that make sure our tests don't rely on the stringification of vscode
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
function diagnosticToPlainObject(diagnostic: vscode.Diagnostic): Diagnostic {
    const plainDiagnostic: Diagnostic = {
        range: rangeToPlainObject(diagnostic.range),
        severity: diagnostic.severity,
        message: diagnostic.message,
    };
    if (diagnostic.relatedInformation) {
        plainDiagnostic.relatedInformation = diagnostic.relatedInformation.map((relatedInfo) => {
            const uri = vscode.workspace.asRelativePath(relatedInfo.location.uri);
            return {
                location: {
                    uri: uri,
                    range: rangeToPlainObject(relatedInfo.location.range)
                },
                message: relatedInfo.message,
            };
        });
    }
    return plainDiagnostic;
}

// Prepare the workspace
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
        // tests are run serially, so nothing will run & break while we're updating
        await openFile(path.join(workspacePath(), "programs", "assert_true.rs"));
        await vscode.commands.executeCommand("prusti-assistant.update");
    });

    // Test every Rust program in the workspace
    const programs: Array<string> = [SCENARIO_PATH, SHARED_SCENARIO_PATH].flatMap(cwd =>
        glob.sync("**/*.rs.json", { cwd: cwd }).map(filePath => filePath.replace(/\.json$/, ""))
    );
    console.log(`Creating tests for ${programs.length} programs: ${programs}`);
    assert.ok(programs.length >= 3, `There are not enough programs to test (${programs.length})`);
    programs.forEach(program => {
        it(`scenario ${SCENARIO} reports expected diagnostics on ${program}`, async () => {
            const programPath = path.join(workspacePath(), program);
            const document = await openFile(programPath);
            await vscode.commands.executeCommand("prusti-assistant.verify");
            const diagnostics = vscode.languages.getDiagnostics(document.uri);
            const plainDiagnostics = diagnostics.map(diagnosticToPlainObject);
            const expectedData = await fs.readFile(programPath + ".json", "utf-8");
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
            // Different build-channel or OS migh report slightly different diagnostics.
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

            expect(expectedDiagnostics.diagnostics).to.deep.equal(plainDiagnostics);
        });
    });

    // FIXME: The following tests have been disabled because:
    // * When running as GitHub actions they randomly fail on MacOS and
    //   sometimes on Windows.
    // * The failures cannot be reproduced locally.
    // * There seem to be no good way of debugging GitHub action runs.
    /*
    it("underlines 'false' in the failing postcondition after choosing 'LatestRelease'", async () => {
        // Choose the LatestRelease toolchain
        const shouldWait = config.buildChannel() !== config.BuildChannel.LatestRelease;
        const configUpdateEvent = shouldWait
            ? state.waitConfigUpdate()
            : Promise.resolve();
        await config.config().update(
            config.buildChannelKey, 
            config.BuildChannel.LatestRelease.toString()
        );
        await configUpdateEvent;
        // Test
        const document = await openFile("failing_post.rs");
        await vscode.commands.executeCommand("prusti-assistant.verify");
        const diagnostics = vscode.languages.getDiagnostics(document.uri);
        assert.ok(
            diagnostics.some(
                (diagnostic) => (
                    document.getText(diagnostic.range).includes("false")
                )
            ),
            "The 'false' expression in the postcondition was not reported. "
            + `Reported diagnostics: [${diagnostics}]`
        );
    });

    it("underlines 'false' in the failing postcondition after choosing 'LatestDev'", async () => {
        // Choose the LatestDev toolchain
        const shouldWait = config.buildChannel() !== config.BuildChannel.LatestDev;
        const configUpdateEvent = shouldWait
            ? state.waitConfigUpdate()
            : Promise.resolve();
        await config.config().update(
            config.buildChannelKey, 
            config.BuildChannel.LatestDev.toString()
        );
        await configUpdateEvent;
        // Test
        const document = await openFile("failing_post.rs");
        await vscode.commands.executeCommand("prusti-assistant.verify");
        const diagnostics = vscode.languages.getDiagnostics(document.uri);
        assert.ok(
            diagnostics.some(
                (diagnostic) => (
                    document.getText(diagnostic.range).includes("false")
                )
            ),
            "The 'false' expression in the postcondition was not reported. "
            + `Reported diagnostics: [${diagnostics}]`
        );
    });
    */
});
