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

        const deps = await prustiTools(tools.currentPlatform!, context);
        const { result, didReportProgress } = await tools.withProgressInWindow(
            `${shouldUpdate ? "Updating" : "Installing"} Prusti`,
            listener => deps.install(config.buildChannel(), shouldUpdate, listener)
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
        util.userError(`Error installing Prusti: ${err}`, true, verificationStatus);
        throw err;
    } finally {
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

export async function spanInfo(): Promise<string> {
    const active_editor = vscode.window.activeTextEditor;
    if (!active_editor) {
        return "no info currently";
    }
    const doc = active_editor.document;
    const selection = active_editor.selection;
    const offset = doc.offsetAt(selection.anchor);
    
    // todo: find the end of this token.

    
    await util.spawn(prusti!.prustiRustc, ["--spaninfo", offset.toString(), doc.fileName]);
    // need to get info
    return doc.fileName +":"+ offset.toString();
}