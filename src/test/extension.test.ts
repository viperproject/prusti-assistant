import * as vscode from "vscode";
import * as path from "path";
import * as glob from "glob";
import { expect } from "chai";
import * as fs from "fs-extra";
import * as state from "../state";
import * as extension from "../extension"

const PROJECT_ROOT = path.join(__dirname, "..", "..");
const DATA_ROOT = path.join(PROJECT_ROOT, "src", "test", "data");
const ASSERT_TRUE = path.join("programs", "assert_true.rs");

function log(msg: string) {
    console.log("[test] " + msg);
}

/**
 * Open a file in the IDE
 *
 * @param fileName
 */
function openFile(fileName: string): Promise<vscode.TextDocument> {
    return new Promise((resolve, reject) => {
        const filePath = path.join(DATA_ROOT, fileName);
        log("Open " + filePath);
        vscode.workspace.openTextDocument(filePath).then(document => {
            vscode.window.showTextDocument(document).then(() => {
                resolve(document);
            }).then(undefined, reject);
        }).then(undefined, reject);
    });
}

describe("Extension", () => {
    before(async () => {
        // Wait until the extension is active
        await openFile(ASSERT_TRUE);
        await state.waitExtensionActivation();
    });

    after(async () => {
        // HACK: It seems that `deactivate` is not called when using the test
        //   suite. So, we manually call the deactivate() function.
        console.log("Tear down test suite");
        await extension.deactivate();
    })

    it("can update Prusti", async () => {
        // tests are run serially, so nothing will run & break while we're updating
        await openFile(ASSERT_TRUE);
        await vscode.commands.executeCommand("prusti-assistant.update");
    });

    const programs: Array<string> = glob.sync("programs/**.rs", { cwd: DATA_ROOT });
    console.log(`Creating tests for ${programs.length} standalone programs`);
    expect(programs.length).to.be.greaterThan(3);
    programs.forEach(program => {
        it(`reports expected diagnostics on ${program}`, async () => {
            const document = await openFile(program);
            await vscode.commands.executeCommand("prusti-assistant.verify");
            const diagnostics = vscode.languages.getDiagnostics(document.uri);
            // Normalize paths
            diagnostics.forEach(d => {
                (d.relatedInformation || []).forEach(r => {
                    r.location.uri = vscode.Uri.file(path.join("DATA", path.relative(DATA_ROOT, r.location.uri.path)));
                })
            });
            const extectedData = await fs.readFile(path.join(DATA_ROOT, program + ".json"), "utf-8");
            const exprected = JSON.parse(extectedData) as [{relatedInformation: [ { location: { uri: { path: string } } }]}];
            expect(diagnostics).to.deep.equal(exprected);
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
