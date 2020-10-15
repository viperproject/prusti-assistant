import * as path from "path";
import * as Mocha from "mocha";
import * as glob from "glob";

// kept as-is (except for the mocha config) from `yo code` extension template
export async function run(): Promise<void> {
    // Create the mocha test
    const mocha = new Mocha({
        ui: "tdd",
        timeout: 60_000, // ms
        color: true,
    });

    const testsRoot = path.resolve(__dirname, "..");

    const files: Array<string> = await new Promise((resolve, reject) =>
        glob(
            'test/*.test.js',
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

    if (failures > 0) {
        throw new Error(`${failures} tests failed.`)
    }
}
