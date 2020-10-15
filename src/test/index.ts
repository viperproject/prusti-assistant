import * as path from "path";
import * as Mocha from "mocha";
import * as glob from "glob";
import NYC = require("nyc");

// kept as-is (except for the mocha config) from `yo code` extension template
export async function run(): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const nyc: NYC = new NYC({
        cwd: path.join(__dirname, "..", ".."),
        //reporter: ['text', 'html'],
        instrument: true,
        hookRequire: true,
        hookRunInContext: true,
        hookRunInThisContext: true,
    });
    await nyc.createTempDirectory();
    await nyc.wrap();

    // Create the mocha test
    const mocha = new Mocha({
        ui: "tdd",
        timeout: 60_000, // ms
        color: true,
    });

    const testsRoot = path.resolve(__dirname, "..");

    const files: Array<string> = await new Promise((resolve, reject) =>
        glob(
            "**/*.test.js",
            {
                cwd: testsRoot,
            },
            (err, files) => {
                if (err) reject(err)
                else resolve(files)
            }
        )
    )

    // Add files to the test suite
    files.forEach(f => mocha.addFile(path.resolve(testsRoot, f)));

    const failures: number = await new Promise(resolve => mocha.run(resolve))
    await nyc.writeCoverageFile()

    if (failures > 0) {
        throw new Error(`${failures} tests failed.`)
    }
}
