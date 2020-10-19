import * as vscode from "vscode";
import * as util from "./util";
import { prusti } from "./dependencies";
import * as config from "./config";
import { ServerManager } from "./toolbox/serverManager";

const serverChannel = vscode.window.createOutputChannel("Prusti Assistant Server");
const server = new ServerManager(
    "Prusti server",
    util.trace
);

/**
 * The address of the server.
 */
export let address: string | undefined;

/**
 * Stop the server.
 */
export async function stop(): Promise<void> {
    address = undefined;
    server.stop();
    await server.waitForStopped();
}

/**
 * Start or restart the server.
 */
export async function restart(context: vscode.ExtensionContext): Promise<void> {
    await stop();

    const configAddress = config.serverAddress();
    if (configAddress !== "") {
        util.log(`Using configured Prusti server address: ${configAddress}`);
        address = configAddress;
        return;
    }

    server.start(
        prusti!.prustiServer,
        ["--port", "0"],
        {
            env: {
                ...process.env,  // Needed e.g. to run Rustup
                // Might not exist yet, but that's handled on the rust side
                PRUSTI_LOG_DIR: context.logPath,
                RUST_BACKTRACE: "1",
                RUST_LOG: "info",
                JAVA_HOME: (await config.javaHome())!.path,
                VIPER_HOME: prusti!.viperHome,
                Z3_EXE: prusti!.z3,
                BOOGIE_EXE: prusti!.boogie
            },
            onStdout: data => {
                serverChannel.append(`[stdout] ${data}`);
                // Extract the server port from the output
                if (address === undefined) {
                    const port = parseInt(data.toString().split("port: ")[1], 10);
                    util.log(`Prusti server is listening on port ${port}.`);
                    address = `localhost:${port}`;
                    vscode.window.setStatusBarMessage("Prusti server is ready.");
                    server.setReady();
                }
            },
            onStderr: data => {
                serverChannel.append(`[stderr] ${data}`);
            }
        }
    );

    server.waitForCrashed().then(() => {
        util.log(`Prusti server crashed.`);
        address = undefined;
        // Ask the user to restart the server
        util.userErrorPopup(
            "Prusti server stopped working.",
            "Restart Server",
            () => {
                restart(context).catch(
                    err => util.log(`Error: ${err}`)
                );
            }
        );
    }).then(
        undefined,
        err => util.log(`Error: ${err}`)
    );

    await server.waitForReady();
}
