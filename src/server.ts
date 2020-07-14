import * as vscode from 'vscode';
import * as util from './util';
import { prusti } from './dependencies';

export let serverPort: number | undefined;

let serverKill: () => void | undefined;
const serverChannel = vscode.window.createOutputChannel("Prusti Server");
export function restartServer() {
    try {
        serverKill?.();
    } catch (e) {
        util.log(`ignoring error killing old prusti server: ${e}`);
    }

    const { output: server, kill } = util.spawn(prusti!.prustiServer, ["--port", "0"], {
        options: {
            env: { RUST_BACKTRACE: "1", ...process.env } // TODO: remove?
        },
        onStdout: line => {
            serverChannel.append(`[stdout] ${line}`);
            if (serverPort !== undefined) { return; }
            serverPort = parseInt(line.toString().split("port: ")[1], 10);
            util.log(`Server running on port ${serverPort}.`);
        },
        onStderr: line => serverChannel.append(`[stderr] ${line}`)
    });

    serverKill = kill;
    server.finally(() => util.userErrorPopup("Prusti server crashed!", "Restart Server", restartServer));
}
