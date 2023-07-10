import * as vscode from "vscode";
import * as util from "./util";
import * as semver from "semver";
import { prusti, prustiSemanticVersion } from "./dependencies";
import * as config from "./config";
import { ServerManager } from "./toolbox/serverManager";

const serverChannel = vscode.window.createOutputChannel("Prusti Assistant Server");
const server = new ServerManager(
    "Prusti server",
    util.log
);

server.waitForUnrecoverable().then(() => {
    util.log(`Prusti server is unrecorevable.`);
    address = undefined;
    util.userError(
        "Prusti server stopped working. Please restart the IDE.",
        true
    );
}).catch(
    err => util.log(`Error: ${err}`)
);

/**
 * The address of the server.
 */
export function registerCrashHandler(context: vscode.ExtensionContext, verificationStatus: vscode.StatusBarItem): void {
    server.waitForCrashed().then(() => {
        util.log("Prusti server crashed.");
        address = undefined;
        // Ask the user to restart the server
        util.userErrorPopup(
            "Prusti server stopped working. " +
            "We would appreciate a [bug report](https://github.com/viperproject/prusti-dev/issues/new). " +
            "See the log (View -> Output -> Prusti Assistant Server) for more details.",
            "Restart Server",
            () => {
                restart(context, verificationStatus).then(
                    () => registerCrashHandler(context, verificationStatus)
                ).catch(
                    err => util.log(`Error: ${err}`)
                );
            },
            verificationStatus
        );
    }).catch(
        err => util.log(`Error: ${err}`)
    );
}

/**
 * The address of the server.
 */
export let address: string | undefined;

/**
 * Stop the server.
 */
export async function stop(): Promise<void> {
    address = undefined;
    server.initiateStop();
    await server.waitForStopped();
}

/**
 * Wait for the server to become ready, with a timeout.
 */
function waitUntilReady(timeout = 10_000): Promise<void> {
    return new Promise((resolve, reject) => {
        let done = false;
        server.waitForReady().then(
            () => {
                if (!done) {
                    done = true;
                    resolve();
                }
            },
            err => {
                if (!done) {
                    done = true;
                    reject(err);
                }
            }
        );
        setTimeout(() => {
            if (!done) {
                done = true;
                reject(
                    `Prusti server took more than ${timeout / 1000} seconds ` +
                    `to start.`
                );
            }
        }, timeout);
    })
}

/**
 * Start or restart the server.
 */
export async function restart(_context: vscode.ExtensionContext, verificationStatus: vscode.StatusBarItem): Promise<void> {
    await stop();

    const configAddress = config.serverAddress();
    if (configAddress !== "") {
        util.log(`Using configured Prusti server address: ${configAddress}`);
        address = configAddress;
        return;
    }

    let prustiServerCwd: string | undefined;
    if (vscode.workspace.workspaceFolders !== undefined) {
        prustiServerCwd = vscode.workspace.workspaceFolders[0].uri.fsPath;
        util.log(`Prusti server will be executed in '${prustiServerCwd}'`);
    }

    const prustiServerArgs = ["--port=0"].concat(
        config.extraPrustiServerArgs()
    );
    util.log("Prusti server args: " + prustiServerArgs.toString());

    // only set this env variable if prusti has at least version 0.3.0
    const versionDependentArgs = semver.lt(prustiSemanticVersion, "0.3.0") ? {} :
        {
            PRUSTI_REPORT_VIPER_MESSAGES: config.reportViperMessages().toString(),
            PRUSTI_SMT_QI_PROFILE: config.reportViperMessages().toString(),
            PRUSTI_SMT_QI_PROFILE_FREQ: config.reportViperMessages() ? config.z3QiProfileFreq().toString() : "",
        };

    const prustiServerEnv = {
        ...process.env,  // Needed to run Rustup
        ...versionDependentArgs,
        ...{
            JAVA_HOME: (await config.javaHome())!.path,
        },
        ...config.extraPrustiEnv(),
    };
    util.log("Prusti server environment: " + JSON.stringify(prustiServerEnv));

    server.initiateStart(
        prusti!.prustiServer,
        prustiServerArgs,
        {
            cwd: prustiServerCwd,
            env: prustiServerEnv,
            onStdout: data => {
                serverChannel.append(`[stdout] ${data}`);
                console.log(`[Prusti Server][stdout] ${data}`);
                // Extract the server port from the output
                if (address === undefined) {
                    const port = parseInt(data.toString().split("port: ")[1], 10);
                    util.log(`Prusti server is listening on port ${port}.`);
                    address = `localhost:${port}`;
                    verificationStatus.text = "Prusti server is ready.";
                    server.setReady();
                }
            },
            onStderr: data => {
                serverChannel.append(`[stderr] ${data}`);
                console.log(`[Prusti Server][stderr] ${data}`);
            }
        }
    );

    await waitUntilReady();
}
