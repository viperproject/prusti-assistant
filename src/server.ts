import * as vscode from 'vscode';
import * as util from './util';
import { prusti } from './dependencies';
import * as config from './config';

export let serverAddress: string | undefined;

let serverKill: () => void | undefined;

const serverChannel = vscode.window.createOutputChannel("Prusti Server");

export function restartServer(context: vscode.ExtensionContext) {
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
            },
            onStderr: line => serverChannel.append(`[stderr] ${line}`)
        }
    );

    serverKill = kill;
    server.finally(() => util.userErrorPopup(
        "Prusti server crashed!",
        "Restart Server",
        () => restartServer(context)
    ));
}
