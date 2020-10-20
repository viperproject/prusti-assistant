import * as vscode from "vscode";
import * as util from "../util";

export async function ensureRustToolchainInstalled(context: vscode.ExtensionContext, toolchainVersion: string, toolchainComponents: string[]): Promise<void> {
    util.log("Checking rust toolchain version...");

    let alreadyNotified = false;
    const notifyRustupInstall = () => {
        if (!alreadyNotified) {
            util.userInfo(
                `Prusti Assistant will install the rust toolchain ${toolchainVersion} and the components required by Prusti.`,
                true,
                false,
                false
            );
            alreadyNotified = true;
        }
    };

    const versionsOutput = await util.spawn(
        "rustup",
        ["toolchain", "list"]
    );
    const versions = versionsOutput.stdout.split("\n");
    if (versions.some(line => line.startsWith(toolchainVersion))) {
        util.log(`Rust toolchain ${toolchainVersion} is already available.`);
    } else {
        util.log(`Rust toolchain ${toolchainVersion} is not available.`);
        notifyRustupInstall();

        const item = vscode.window.createStatusBarItem();
        const updateText = (text: string) => item.text = `$(loading~spin) rustup: ${text}`;
        updateText(`Installing toolchain ${toolchainVersion}...`);
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
        );
        item.dispose();
    }

    util.log("Checking Rust toolchain components...");
    const componentsOutput = await util.spawn(
        "rustup",
        ["+" + toolchainVersion, "component", "list"]
    );
    const components = componentsOutput.stdout.split("\n");
    for (const toolchainComponent of toolchainComponents) {
        const alreadyInstalled = components.some(line => (
            line.startsWith(toolchainComponent) && line.endsWith("(installed)")
        ));
        if (alreadyInstalled) {
            util.log(`Rust toolchain component ${toolchainComponent} is already available.`);
        } else {
            util.log(`Rust toolchain component ${toolchainComponent} is not available.`);
            notifyRustupInstall();

            const item = vscode.window.createStatusBarItem();
            const updateText = (text: string) => item.text = `$(loading~spin) rustup: ${text}`;
            updateText(`Installing rust toolchain component ${toolchainComponent}...`);
            item.show();
            context.subscriptions.push(item);
            await util.spawn(
                "rustup",
                ["+" + toolchainVersion, "component", "add", toolchainComponent],
                {
                    onStderr: output => {
                        updateText(("" + output).trim());
                    }
                }
            );
            item.dispose();
        }
    }
}
