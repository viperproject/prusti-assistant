import * as util from "./util";
import * as config from "./config";
import * as path from "path";
import * as fs from "fs-extra";
import { PrustiLocation } from "./dependencies";

export async function hasPrerequisites(): Promise<[boolean, string]> {
    util.log("Checking Java home...");
    if (await config.javaHome() === null) {
        const msg = "Could not find the Java home. Please install Java 11+ " +
            "64bit or set the 'javaHome' setting, then restart the IDE.";
        return [false, msg];
    }
    util.log("Checking Rustup and Cargo...");
    try {
        await util.spawn("rustup", ["--version"]);
        await util.spawn("cargo", ["--version"]);
    } catch (err) {
        util.log(`Error: ${err}`);
        const msg = "Could not run Rustup. Please visit " +
            "[https://rustup.rs/](https://rustup.rs/) and install Rustup, " +
            "then restart the IDE.";
        return [false, msg];
    }
    util.log("Checking Java...");
    try {
        const javaPath = path.join(
            (await config.javaHome())!.javaExecutable
        );
        await util.spawn(javaPath, ["-version"]);
    } catch (err) {
        util.log(`Error: ${err}`);
        const msg = "Could not run Java. Please install Java 11+ 64bit " +
            "or set the 'javaHome' setting, then restart the IDE.";
        return [false, msg];
    }
    return [true, ""];
}

export async function checkPrusti(prusti: PrustiLocation): Promise<[boolean, string]> {
    util.log("Checking Z3...");
    try {
        await util.spawn(prusti.z3, ["--version"]);
    } catch (err) {
        util.log(`Error: ${err}`);
        const msg = "Could not run Z3. " +
            "Please try updating the verifier, then restart the IDE.";
        return [false, msg];
    }
    util.log("Checking Prusti...");
    try {
        await util.spawn(prusti.prustiRustc, ["--version"]);
    } catch (err) {
        util.log("Could not run prusti-rustc");
        util.log(`Error: ${err}`);
        const msg = "Could not run Prusti. " +
            "Please try updating the verifier, then restart the IDE.";
        return [false, msg];
    }
    util.log("Checking Cargo-Prusti...");
    try {
        await util.spawn(prusti.cargoPrusti, ["--help"]);
    } catch (err) {
        util.log("Could not run cargo-prusti");
        util.log(`Error: ${err}`);
        const msg = "Could not run Prusti. " +
            "Please try updating the verifier, then restart the IDE.";
        return [false, msg];
    }
    return [true, ""];
}

// Check if Prusti is older than numDays or is older than the VS Code extension.
export async function isOutdated(prusti: PrustiLocation, numDays = 30): Promise<boolean> {
    // No need to update a fixed Prusti version
    if (config.prustiVersion() !== config.PrustiVersion.Latest) {
        return false;
    }

    // TODO: Lookup on GitHub if there actually is a more recent version to download.
    const prustiDownloadDate = (await fs.stat(prusti.rustToolchainFile().path())).ctime.getTime();
    const pastNumDays = new Date(new Date().setDate(new Date().getDate() - numDays)).getTime();
    const olderThanNumDays = prustiDownloadDate < pastNumDays;
    const extensionDownloadDate = (await fs.stat(__filename)).ctime.getTime();
    const olderThanExtension = prustiDownloadDate < extensionDownloadDate;
    return olderThanNumDays || olderThanExtension;
}
