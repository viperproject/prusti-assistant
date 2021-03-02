import * as vscode from "vscode";
import { Location } from "vs-verification-toolbox";
import * as util from "../util";

export async function ensureRustToolchainInstalled(context: vscode.ExtensionContext, toolchainFolder: Location): Promise<void> {
    util.log("Checking rust toolchain version and components...");

    const rustupOutput = await util.spawn(
        "rustup",
        ["show"],
        { options: { cwd: toolchainFolder.toString() }}
    );

    if (rustupOutput.code != 0) {
        throw new Error(`Rustup terminated with exit code ${rustupOutput.code}`);
    }
}
