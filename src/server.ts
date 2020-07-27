import * as vscode from 'vscode';
import * as util from './util';
import { prusti } from './dependencies';
import * as config from './config';

export let serverAddress: string | undefined;

let serverKill: () => void | undefined;
const serverChannel = vscode.window.createOutputChannel("Prusti Server");
export function restartServer() {
    try {
        serverKill?.();
    } catch (e) {
        util.log(`ignoring error killing old prusti server: ${e}`);
    }
    serverAddress = undefined;

    const configAddress = config.serverAddress();
    if (configAddress !== "") {
        serverAddress = configAddress;
        return;
    }

    const { output: server, kill } = util.spawn(prusti!.prustiServer, ["--port", "0"], {
        options: {
            env: { RUST_BACKTRACE: "1", ...process.env } // TODO: remove?
        },
        onStdout: line => {
            serverChannel.append(`[stdout] ${line}`);
            if (serverAddress !== undefined) { return; }
            const port = parseInt(line.toString().split("port: ")[1], 10);
            util.log(`Server running on port ${port}.`);
            serverAddress = `localhost:${port}`;
        },
        onStderr: line => serverChannel.append(`[stderr] ${line}`)
    });

    serverKill = kill;
    server.finally(() => util.userErrorPopup("Prusti server crashed!", "Restart Server", restartServer));
}
