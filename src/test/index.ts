import * as path from "path";
import * as Mocha from "mocha";
import * as glob from "glob";
import * as inspector from "inspector";
import * as fs from "fs";
import * as process from "process";
import NYC = require("nyc");

export async function run(): Promise<void> {
    const nyc: NYC = new NYC({
        cwd: path.join(__dirname, "..", ".."),
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
        // Installing Rustup and Prusti might take some minutes
        timeout: 600_000, // ms
        color: true,
    });

    const testsRoot = path.resolve(__dirname, "..");

    const files: Array<string> = await new Promise((resolve, reject) =>
        glob(
            "**/*.test.js",
            {
                cwd: testsRoot,
            },
            (err, result) => {
                if (err) reject(err)
                else resolve(result)
            }
        )
    )

    // Add files to the test suite
    files.forEach(f => mocha.addFile(path.resolve(testsRoot, f)));

    let failures = -1;
    if (!process.env.DUMP_DEBUG_INFO) {
        failures = await new Promise(resolve => mocha.run(resolve));
    } else {
        const timestamp = Math.floor(Date.now() / 1000);
        console.log(`Start profiling (timestamp: ${timestamp})...`)
        const session = new inspector.Session();
        session.connect();
        await new Promise(resolve => session.post("Profiler.enable", resolve));
        await new Promise(resolve => session.post("Profiler.start", resolve));

        // Run the tests
        failures = await new Promise(resolve => mocha.run(resolve));

        // Take a heap snapshot
        const heapsnapshot_filename = `tests-${timestamp}.heapsnapshot`;
        console.log(`Dump heap snapshot to '${heapsnapshot_filename}'...`)
        const heapsnapshot_file = fs.openSync(heapsnapshot_filename, "w");
        session.on("HeapProfiler.addHeapSnapshotChunk", (m) => {
            fs.writeSync(heapsnapshot_file, m.params.chunk);
        });
        await new Promise(resolve => {
            session.post("HeapProfiler.takeHeapSnapshot", (err) => {
                if (err) {
                    console.warn(`Error while taking a snapshot of the heap: ${err}`);
                }
                resolve(null);
            });
        });
        fs.closeSync(heapsnapshot_file);

        // Dump CPU profile
        const cpuprofile = await new Promise(resolve => {
            session.post("Profiler.stop", (err, { profile }) => {
                if (err) {
                    console.warn(`Error while profiling the CPU: ${err}`);
                    resolve(null);
                } else {
                    resolve(profile);
                }
            });
        });
        const cpuprofile_filename = `tests-${timestamp}.cpuprofile`;
        console.log(`Dump CPU profile to '${cpuprofile_filename}'...`)
        fs.writeFileSync(cpuprofile_filename, JSON.stringify(cpuprofile));

        // Clean up
        session.disconnect();
    }
    await nyc.writeCoverageFile()

    if (failures > 0) {
        throw new Error(`${failures} tests failed.`)
    }
}
