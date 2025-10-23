export * from "./PrustiLocation";
import * as tools from "vs-verification-toolbox";
import * as vscode from "vscode";
import * as config from "../config";
import * as util from "../util";
import * as server from "../server";
import * as rustup from "./rustup";
import { PrustiLocation } from "./PrustiLocation";
import { prustiTools } from "./prustiTools";
import { Location } from "vs-verification-toolbox";

export let prusti: PrustiLocation | undefined;
export let prustiSemanticVersion = "0.0.0";
export async function installDependencies(context: vscode.ExtensionContext, shouldUpdate: boolean, verificationStatus: vscode.StatusBarItem): Promise<void> {
    try {
        util.log(`${shouldUpdate ? "Updating" : "Installing"} Prusti dependencies...`);

        // Stop the server before trying to remove its files
        await server.stop();

        // TODO: Stop prusti-rustc and cargo-prusti

        const deps = await prustiTools(tools.currentPlatform!, context);
        const prustiVersion = config.prustiVersion();
        util.log(`Installing Prusti version: ${prustiVersion}`);
        const { result, didReportProgress } = await tools.withProgressInWindow(
            `${shouldUpdate ? "Updating" : "Installing"} Prusti`,
            listener => deps.install(prustiVersion, shouldUpdate, listener)
        );
        if (!(result instanceof tools.Success)) {
            util.userError(
                "Prusti installation has been canceled. Please restart the IDE to retry.",
                true, verificationStatus
            )
            // FIXME: The rest of the extension expects `prusti` to be defined.
            return;
        }
        const location = result.value as tools.Location;
        const viperToolsDirectory = await getViperToolsDirectory(location);
        const rustToolchainLocation = await getRustToolchainLocation(location);
        util.log(`Using Prusti at ${location}`)
        prusti = new PrustiLocation(location, viperToolsDirectory, rustToolchainLocation);

        // only notify user about success if we reported anything in between;
        // otherwise there was nothing to be done.
        if (didReportProgress) {
            util.userInfo(
                `Prusti ${shouldUpdate ? "updated" : "installed"} successfully.`
            );
        }

        // Install Rust toolchain
        await rustup.ensureRustToolchainInstalled(
            context,
            rustToolchainLocation
        );
    } catch (err) {
        util.userError(`Error installing Prusti: ${err}`, true, verificationStatus);
        throw err;
    } finally {
        await updatePrustiSemVersion();
        await server.restart(context, verificationStatus);
    }
}

export async function prustiVersion(): Promise<string> {
    const output = await util.spawn(prusti!.prustiRustc, ["--version"]);
    let version = output.stderr.split("\n")
        .filter(line => line.trim().length > 0 && line.indexOf("version") != -1)
        .join(". ");
    if (version.trim().length === 0) {
        version = "<unknown>";
    }
    if (version.indexOf("Prusti") === -1) {
        version = "Prusti version: " + version;
    }
    return version;
}

/**
 * Returns the location of the `viper_tools` directory. This function starts the
 * search by looking in the Prusti location for a child folder `viper_tools`; if
 * not found, it looks upwards until a `viper_tools` directory can be found.
 *
 * In general, the `viper_tools` directory will be a child of the Prusti
 * location; however, when using a development version of Prusti (e.g. where
 * Prusti's location would be set as prusti-dev/target/debug), `viper_tools`
 * would be in the `prusti-dev` directory.
 */
async function getViperToolsDirectory(prustiLocation: Location): Promise<Location> {
    const location = await searchForChildInEnclosingFolders(prustiLocation, "viper_tools");
    if(location) {
        return location;
    } else {
        throw new Error(`Could not find viper_tools directory from ${prustiLocation}.`);
    }
}

/**
 * Returns the location of the `rust-toolchain` file. This function starts the
 * search by looking in the Prusti location for a child file `rust-toolchain`;
 * if not found, it looks upwards until a `rust-toolchain` file can be found.
 *
 * In general, the `rust-toolchain` file will be a child of the Prusti location;
 * however, when using a development version of Prusti (e.g. where Prusti's
 * location would be set as prusti-dev/target/debug), `rust-toolchain` would be
 * in the `prusti-dev` directory.
 */
async function getRustToolchainLocation(prustiLocation: Location): Promise<Location> {
    const location = await searchForChildInEnclosingFolders(prustiLocation, "rust-toolchain");
    if(location) {
        return location;
    } else {
        throw new Error(`Could not find rust-toolchain file from ${prustiLocation}.`);
    }
}

async function searchForChildInEnclosingFolders(initialLocation: Location, childName: string): Promise<Location | undefined> {
    let location = initialLocation;
    // eslint-disable-next-line no-constant-condition
    while (true) {
        const childLocation = location.child(childName);
        if(await childLocation.exists()) {
            return childLocation;
        }
        if(location.path() === location.enclosingFolder.path()) {
            // We've reached the root folder
            return;
        }
        location = location.enclosingFolder;
    }
}
export async function updatePrustiSemVersion(): Promise<void> {
    const version = await prustiVersion();
    // version will have the form Prusti version: 0.x.x, commit 234..hash..
    const parts = version.split(" ");
    if (parts.length < 3 || parts[2] === undefined) {
        util.log("Could not parse Prusti version, defaulting to 0.0.0");
        prustiSemanticVersion = "0.0.0";
        return;
    }
    const result = parts[2].slice(0, -1);
    if (result.includes("<") || result.includes(">") || !/^\d+\.\d+\.\d+/.test(result)) {
        util.log(`Could not parse Prusti version from "${version}", defaulting to 0.0.0`);
        prustiSemanticVersion = "0.0.0";
        return;
    }
    util.log("Setting prustiVersion to " + result);
    prustiSemanticVersion = result;
}

