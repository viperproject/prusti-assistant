export * from "./PrustiLocation";
import * as tools from "vs-verification-toolbox";
import * as vscode from "vscode";
import * as config from "../config";
import * as util from "../util";
import * as server from "../server";
import * as rustup from "./rustup";
import { PrustiLocation } from "./PrustiLocation";
import { prustiTools } from "./prustiTools";

export let prusti: PrustiLocation | undefined;
export async function installDependencies(context: vscode.ExtensionContext, shouldUpdate: boolean, verificationStatus: vscode.StatusBarItem): Promise<void> {
    try {
        util.log(`${shouldUpdate ? "Updating" : "Installing"} Prusti dependencies...`);

        // Stop the server before trying to remove its files
        await server.stop();

        // TODO: Stop prusti-rustc and cargo-prusti

        const deps = prustiTools(tools.currentPlatform!, context);
        const { result, didReportProgress } = await tools.withProgressInWindow(
            `${shouldUpdate ? "Updating" : "Installing"} Prusti`,
            listener => deps.install(config.buildChannel(), shouldUpdate, listener)
        );
        if (!(result instanceof tools.Success)) {
            util.userError(
                "Prusti installation has been canceled. Please restart the IDE to retry.",
                true, verificationStatus
            )
        }
        const location = (result as tools.Success<tools.Location>).value;
        util.log(`Using Prusti at ${location}`)
        prusti = new PrustiLocation(location);

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
            prusti.rustToolchainFile(),
        );
    } catch (err) {
        util.userError(`Error installing Prusti: ${err}`, false, verificationStatus);
        throw err;
    } finally {
        await server.restart(context, verificationStatus);
    }
}
