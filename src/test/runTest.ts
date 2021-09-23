import * as path from "path";
import * as fs from "fs";
import * as tmp from "tmp";

import { runTests } from "@vscode/test-electron";
import { assert } from "console";

const PROJECT_ROOT = path.join(__dirname, "..", "..");
const DATA_ROOT = path.join(PROJECT_ROOT, "src", "test", "data");

async function main() {
    // The folder containing the Extension Manifest package.json
    // Passed to `--extensionDevelopmentPath`
    const extensionDevelopmentPath = path.resolve(__dirname, "../../");

    // The path to the extension test runner script
    // Passed to --extensionTestsPath
    const extensionTestsPath = path.resolve(__dirname, "./index");

    // Download VS Code, unzip it and run the integration test
    console.info("Reading VS Code version...");
    const vscodeVersion = fs.readFileSync(path.join(DATA_ROOT, "vscode-version")).toString().trim();
    console.info(`Tests will use VS Code version '${vscodeVersion}'`);
    console.info("Reading list of settings...");
    const settingsList = fs.readdirSync(path.join(DATA_ROOT, "settings")).sort();
    assert(settingsList.length > 0, "There are no settings to test");

    let firstIteration = true;
    for (const settingsFile of settingsList) {
        if (!firstIteration) {
            // Workaround for a weird "exit code 55" error that happens on
            // Mac OS when starting a new vscode instance immediately after
            // closing an old one.
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
        console.info(`Testing with settings '${settingsFile}'...`);
        const tmpWorkspace = tmp.dirSync({ unsafeCleanup: true });
        try {
            // Prepare the workspace with the settings
            console.info(`Using temporary workspace '${tmpWorkspace.name}'`);
            const settingsPath = path.join(DATA_ROOT, "settings", settingsFile);
            const workspaceVSCodePath = path.join(tmpWorkspace.name, ".vscode")
            const workspaceSettingsPath = path.join(workspaceVSCodePath, "settings.json")
            fs.mkdirSync(workspaceVSCodePath);
            fs.copyFileSync(settingsPath, workspaceSettingsPath);

            // Run the tests in the workspace
            await runTests({
                version: vscodeVersion,
                extensionDevelopmentPath,
                extensionTestsPath,
                extensionTestsEnv: process.env,
                // Disable any other extension
                launchArgs: ["--disable-extensions", tmpWorkspace.name],
            });
        } finally {
            tmpWorkspace.removeCallback();
        }
        firstIteration = false;
    }
}

main().catch(err => {
    console.error(err);
    console.error("Failed to run tests");
    process.exit(1);
});
