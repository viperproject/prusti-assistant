import * as vscode from "vscode";
import { Location } from "vs-verification-toolbox";
import * as util from "../util";

export async function ensureRustToolchainInstalled(context: vscode.ExtensionContext, toolchainFile: Location): Promise<void> {
    util.log("Checking rust toolchain version and components...");
    util.trace(`Using rust-toolchain at ${toolchainFile}`);

    if (!await toolchainFile.exists()) {
        throw new Error(`The rust-toolchain file at ${toolchainFile} does not exist.`);
    }

    // `rustup show` will install the missing toolchain and components
    const rustupOutput = await util.spawn(
        "rustup",
        ["show"],
        { options: { cwd: toolchainFile.enclosingFolder.path() }}
    );

    if (rustupOutput.code != 0) {
        throw new Error(`Rustup terminated with exit code ${rustupOutput.code}`);
    }
}
