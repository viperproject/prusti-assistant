import * as vscode from "vscode";
import * as util from "./util";
import { prusti } from "./dependencies";
import * as config from "./config";
import * as state from "./state";

export let serverAddress: string | undefined;

let serverKill: () => void | undefined;

const serverChannel = vscode.window.createOutputChannel("Prusti Server");

export async function restartServer(context: vscode.ExtensionContext): Promise<void> {
    try {
        serverKill?.();
    } catch (e) {
        util.log(`Error ignored while killing the Prusti server: ${e}`);
    }
    serverAddress = undefined;

    const configAddress = config.serverAddress();
    if (configAddress !== "") {
        util.log(`Using configured Prusti server address: ${configAddress}`);
        serverAddress = configAddress;
        return;
    }

    const { output: server, kill } = util.spawn(
        prusti!.prustiServer,
        ["--port", "0"],
        {
            options: {
                env: {
                    // Might not exist yet, but that's handled on the rust side
                    PRUSTI_LOG_DIR: context.logPath,
                    RUST_BACKTRACE: "1",
                    RUST_LOG: "info",
                    JAVA_HOME: (await config.javaHome()).path,
                    VIPER_HOME: prusti!.viperHome,
                    Z3_EXE: prusti!.z3,
                    BOOGIE_EXE: prusti!.boogie,
                    ...process.env
                }
            },
            onStdout: line => {
                serverChannel.append(`[stdout] ${line}`);
                if (serverAddress !== undefined) { return; }
                // Extract the server port from the output
                const port = parseInt(line.toString().split("port: ")[1], 10);
                util.log(`Prusti server is listening on port ${port}.`);
                serverAddress = `localhost:${port}`;
                state.notifyPrustiServerReady();
            },
            onStderr: line => {
                serverChannel.append(`[stderr] ${line}`);
            }
        }
    );

    serverKill = kill;
    server.finally(() => {
        state.notifyPrustiServerStop();
        // Ask the user to restart the server
        util.userErrorPopup(
            "Prusti server crashed!",
            "Restart Server",
            () => void restartServer(context)
        );
    });
}
