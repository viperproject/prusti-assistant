import * as path from "path";
import * as fs from "fs";
import * as tmp from "tmp";

import { runTests } from "vscode-test";
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
    const vscode_version = fs.readFileSync(path.join(DATA_ROOT, "vscode-version")).toString().trim();
    console.info(`Tests will use VS Code version '${vscode_version}'`);
    console.info("Reading list of settings...");
    const settings_list = fs.readdirSync(path.join(DATA_ROOT, "settings")).sort();
    assert(settings_list.length > 0, "There are no settings to test");

    for (const settings_file of settings_list) {
        console.info(`Testing with settings '${settings_file}'...`);
        const tmpWorkspace = tmp.dirSync({ unsafeCleanup: true });
        try {
            // Prepare the workspace with the settings
            const settings_path = path.join(DATA_ROOT, "settings", settings_file);
            const workspace_vscode_path = path.join(tmpWorkspace.name, ".vscode")
            const workspace_settings_path = path.join(workspace_vscode_path, "settings.json")
            fs.mkdirSync(workspace_vscode_path);
            fs.copyFileSync(settings_path, workspace_settings_path)
            
            // Run the tests in the workspace
            await runTests({
                version: vscode_version,
                extensionDevelopmentPath,
                extensionTestsPath,
                // Disable any other extension
                launchArgs: ["--disable-extensions", tmpWorkspace.name, "--disable-gpu", "--log", "debug"],
            });
        } finally {
            tmpWorkspace.removeCallback();
        }
    }
}

main().catch(err => {
    console.error(err);
    console.error("Failed to run tests");
    process.exit(1);
});
