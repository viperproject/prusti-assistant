import * as vscode from "vscode";
import * as util from "../util";

export async function ensureRustToolchainInstalled(context: vscode.ExtensionContext, toolchainVersion: string): Promise<void> {
    util.log("Checking rust toolchain version...");

    const versionsOutput = await util.spawn("rustup", ["toolchain", "list"]).output;
    const versions = versionsOutput.stdout.split("\n");
    if (versions.some(line => line.startsWith(toolchainVersion))) {
        util.log("Correct rust toolchain available.");
        return;
    }
    util.log(`Rust toolchain ${toolchainVersion} is not available.`);

    util.userInfo(
        `Installing rust toolchain version ${toolchainVersion}, required by Prusti...`
    );

    const item = vscode.window.createStatusBarItem();
    const updateText = (text: string) => item.text = `$(loading~spin) rustup: ${text}`;
    updateText("Installing toolchain...");
    item.show();
    context.subscriptions.push(item);
    await util.spawn(
        "rustup",
        ["toolchain", "install", toolchainVersion],
        {
            onStderr: output => {
                updateText(("" + output).trim());
            }
        }
    ).output;
    item.dispose();
}
