export * from "./PrustiLocation";

import { withProgressInWindow, currentPlatform } from "vs-verification-toolbox";
import * as vscode from "vscode";

import * as config from "../config";
import * as util from "../util";
import * as server from "../server";
import { PrustiLocation } from "./PrustiLocation";
import { prustiTools } from "./prustiTools";
import { ensureRustToolchainInstalled } from "./rustup";

export let prusti: PrustiLocation | undefined;
export async function installDependencies(context: vscode.ExtensionContext, shouldUpdate: boolean): Promise<void> {
    try {
        util.log(`${shouldUpdate ? "Updating" : "Installing"} Prusti dependencies...`);

        // Stop the server before trying to remove its files
        server.stop();

        // TODO: stop prusti-rustc and cargo-prusti

        const tools = await prustiTools(currentPlatform!, context);
        const { result: location, didReportProgress } = await withProgressInWindow(
            `${shouldUpdate ? "Updating" : "Installing"} Prusti`,
            listener => tools.install(config.buildChannel(), shouldUpdate, listener)
        );
        util.log(`Prusti is now at ${location}`)
        prusti = new PrustiLocation(location);

        // only notify user about success if we reported anything in between; otherwise there was nothing to be done.
        if (didReportProgress) {
            if (shouldUpdate) {
                // have to reload
                util.userInfo("Prusti updated successfully. Please reload the IDE.", true, true);
            } else {
                util.userInfo("Prusti installed successfully.");
            }
        }

        // Install Rust toolchain
        await ensureRustToolchainInstalled(
            context,
            await prusti.rustToolchainVersion(),
            config.isStableBuildChannel()
                ? []
                : ["rustc-dev", "llvm-tools-preview"],
        );
    } catch (err) {
        util.userError(`Error installing Prusti: ${err}`);
        throw err;
    } finally {
        await server.restart(context);
    }
}
