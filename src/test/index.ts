import * as path from "path";
import * as Mocha from "mocha";
import * as glob from "glob";
import NYC = require("nyc");

export async function run(): Promise<void> {
    const nyc: NYC = new NYC({
        cwd: path.join(__dirname, "..", ".."),
        instrument: true,
        extension: [
            ".ts",
            ".tsx"
        ],
        exclude: [
            "**/*.d.ts",
            "**/.vscode-test/**"
        ],
        all: true,
        hookRequire: true,
        hookRunInContext: true,
        hookRunInThisContext: true,
    });
    await nyc.createTempDirectory();
    await nyc.wrap();

    // Create the mocha test
    const mocha = new Mocha({
        ui: "bdd",
        // Installing Rustup and Prusti might take some minutes
        timeout: 600_000, // ms
        color: true,
    });

    const testsRoot = path.resolve(__dirname, "..");
    const files: Array<string> = glob.sync("**/*.test.js", { cwd: testsRoot });

    // Add files to the test suite
    files.forEach(f => mocha.addFile(path.resolve(testsRoot, f)));

    const failures: number = await new Promise(resolve => mocha.run(resolve));
    await nyc.writeCoverageFile()

    if (failures > 0) {
        throw new Error(`${failures} tests failed.`)
    }
}
