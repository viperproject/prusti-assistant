import * as path from "path";

import { runTests } from "vscode-test";

async function main() {
    // The folder containing the Extension Manifest package.json
    // Passed to `--extensionDevelopmentPath`
    const extensionDevelopmentPath = path.resolve(__dirname, "../../");

    // The path to the extension test runner script
    // Passed to --extensionTestsPath
    const extensionTestsPath = path.resolve(__dirname, "./index");

    // Download VS Code, unzip it and run the integration test
    console.info("Run tests...");
    await runTests({
        version: "1.43.0",
        extensionDevelopmentPath,
        extensionTestsPath,
        // Disable any other extension
        launchArgs: ["--disable-extensions"],
    });
}

main().catch(err => {
    console.error(err);
    console.error("Failed to run tests");
    process.exit(1);
});
