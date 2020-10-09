import * as vscode from "vscode";
import * as util from "./util";
import { prusti } from "./dependencies";
import * as config from "./config";
import { ServerManager } from "./toolbox/serverManager";

const serverChannel = vscode.window.createOutputChannel("Prusti Assistant Server");
const server = new ServerManager(
    "Prusti server",
    (data) => { util.log(data); serverChannel.append(data); }
);

/**
 * The address of the server.
 */
export let serverAddress: string | undefined;

/**
 * Stop the server.
 */
export function stopServer(): void {
    server.stop();
}

/**
 * Start or restart the server.
 */
export async function restartServer(context: vscode.ExtensionContext): Promise<void> {
    stopServer();

    const configAddress = config.serverAddress();
    if (configAddress !== "") {
        util.log(`Using configured Prusti server address: ${configAddress}`);
        serverAddress = configAddress;
        return;
    }

    server.start(
        prusti!.prustiServer,
        ["--port", "0"],
        {
            env: {
                // Might not exist yet, but that's handled on the rust side
                PRUSTI_LOG_DIR: context.logPath,
                RUST_BACKTRACE: "1",
                RUST_LOG: "info",
                JAVA_HOME: (await config.javaHome())!.path,
                VIPER_HOME: prusti!.viperHome,
                Z3_EXE: prusti!.z3,
                BOOGIE_EXE: prusti!.boogie,
                ...process.env
            },
            onStdout: line => {
                serverChannel.append(`[stdout] ${line}`);
                // Extract the server port from the output
                if (serverAddress === undefined) {
                    const port = parseInt(line.toString().split("port: ")[1], 10);
                    util.log(`Prusti server is listening on port ${port}.`);
                    serverAddress = `localhost:${port}`;
                    server.setReady();
                }
            },
            onStderr: line => {
                serverChannel.append(`[stderr] ${line}`);
            }
        }
    );

    void server.waitForCrashed().then(() => {
        util.log(`Prusti server crashed.`);
        // Ask the user to restart the server
        util.userErrorPopup(
            "Prusti server stopped working.",
            "Restart Server",
            () => void restartServer(context)
        );
    });
}
