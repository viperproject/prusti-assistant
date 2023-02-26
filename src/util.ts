import * as childProcess from "child_process";
import * as vscode from "vscode";
import * as treeKill from "tree-kill";
import { projects } from "./projects";

export function userInfo(message: string, statusBar?: vscode.StatusBarItem): void {
    log(message);
    if (statusBar) {
        statusBar.text = message;
    }
    vscode.window.showInformationMessage(message).then(
        undefined,
        err => log(`Error: ${err}`)
    );
}

export function userWarn(message: string, statusBar?: vscode.StatusBarItem): void {
    log(message);
    if (statusBar) {
        statusBar.text = message;
    }
    vscode.window.showWarningMessage(message).then(
        undefined,
        err => log(`Error: ${err}`)
    );
}

export function userError(message: string, restart = false, statusBar?: vscode.StatusBarItem): void {
    log(message);
    if (statusBar) {
        statusBar.text = message;
    }
    if (restart) {
        userErrorPopup(
            message,
            "Restart Now",
            () => {
                vscode.commands.executeCommand("workbench.action.reloadWindow")
                    .then(undefined, err => log(`Error: ${err}`));
            },
            statusBar
        );
    } else {
        vscode.window.showErrorMessage(message)
            .then(undefined, err => log(`Error: ${err}`));
    }
}

export function userErrorPopup(message: string, actionLabel: string, action: () => void, statusBar?: vscode.StatusBarItem): void {
    log(message);
    if (statusBar) {
        statusBar.text = message;
    }
    vscode.window.showErrorMessage(message, actionLabel)
        .then(selection => {
            if (selection === actionLabel) {
                action();
            }
        })
        .then(undefined, err => log(`Error: ${err}`));
}

export function userInfoPopup(message: string, actionLabel?: string, action?: () => void, statusBar?: vscode.StatusBarItem): void {
    log(message);
    if (statusBar) {
        statusBar.text = message;
    }
    if (action != undefined && actionLabel != undefined) {
        vscode.window.showInformationMessage(message, actionLabel)
            .then(selection => {
                if (selection === actionLabel) {
                    action();
                }
            })
            .then(undefined, err => log(`Error: ${err}`));
    } else {
        void vscode.window.showInformationMessage(message);
    }
}

const subProcessLogChannel = vscode.window.createOutputChannel("Prusti Assistant Subprocesses")
function logSubProcess(message: string): void {
    subProcessLogChannel.appendLine(message);
}

const logChannel = vscode.window.createOutputChannel("Prusti Assistant");
export function log(message: string): void {
    console.log(message);
    logChannel.appendLine(message);
}

export type Duration = [seconds: number, nanoseconds: number];
export type KillFunction = () => void;

export interface Output {
    stdout: string;
    stderr: string;
    code: number | null;
    signal: string | null;
    duration: Duration;
}

export function spawn(
    cmd: string,
    args?: string[] | undefined,
    { options, onStdout, onStderr }: {
        options?: childProcess.SpawnOptionsWithoutStdio;
        onStdout?: ((data: string) => void);
        onStderr?: ((data: string) => void);
    } = {},
    destructors?: Set<KillFunction>,
): Promise<Output> {
    const description = `${cmd} ${args?.join(" ") ?? ""}`;
    log(`Run command '${description}'`);

    let stdout = "";
    let stderr = "";

    const start = process.hrtime();
    const proc = childProcess.spawn(cmd, args, options);
    const status: { killed: boolean } = { killed: false };
    log(`Spawned PID: ${proc.pid}`);

    // Register destructor
    function killProc() {
        if (!status.killed) {
            status.killed = true;
            // TODO: Try with SIGTERM before.
            treeKill(proc.pid, "SIGKILL", (err) => {
                if (err) {
                    log(`Failed to kill process tree of ${proc.pid}: ${err}`);
                    const succeeded = proc.kill("SIGKILL");
                    if (!succeeded) {
                        log(`Failed to kill process ${proc}.`);
                    }
                } else {
                    log(`Process ${proc.pid} has been killed successfully.`);
                }
            });
        } else {
            log(`Process ${proc.pid} has already been killed.`);
        }
    }
    if (destructors) {
        destructors.add(killProc);
    }

    proc.stdout.on("data", (data) => {
        stdout += data;
        try {
            onStdout?.(data);
        } catch (e) {
            log(`error in stdout handler for '${description}': ${e}`);
        }
    });
    proc.stderr.on("data", (data) => {
        stderr += data;
        try {
            onStderr?.(data);
        } catch (e) {
            log(`error in stderr handler for '${description}': ${e}`);
        }
    });

    function printOutput(duration: Duration, code: number | null, signal: NodeJS.Signals | null) {
        const durationSecMsg = (duration[0] + duration[1] / 1e9).toFixed(1);
        logSubProcess(`Output from '${description}' (${durationSecMsg}s):`);
        logSubProcess("┌──── Begin stdout ────┐");
        logSubProcess(stdout);
        logSubProcess("└──── End stdout ──────┘");
        logSubProcess("┌──── Begin stderr ────┐");
        logSubProcess(stderr);
        logSubProcess("└──── End stderr ──────┘");
        logSubProcess(`Exit code ${code}, signal ${signal}.`);
    }

    return new Promise((resolve, reject) => {
        proc.on("close", (code, signal) => {
            const duration = process.hrtime(start);
            printOutput(duration, code, signal);
            if (destructors) {
                destructors.delete(killProc);
            }
            resolve({ stdout, stderr, code, signal, duration });
        });
        proc.on("error", (err) => {
            const duration = process.hrtime(start);
            printOutput(duration, null, null);
            log(`Error: ${err}`);
            if (destructors) {
                destructors.delete(killProc);
            }
            reject(err);
        });
    });
}

/**
 * Given a range, possibly spanning multiple lines this function will return a range
 * that includes all of the first line. The purpose of this is that decorators
 * that are displayed "behind" this range, will not be in the middle of some text
 */
export function FullLineRange(range: vscode.Range): vscode.Range {
    let position = new vscode.Position(range.start.line, range.start.character);
    let position_test = new vscode.Position(range.start.line, Number.MAX_SAFE_INTEGER);

    return new vscode.Range(position, position_test)
}

/** Either returns the path to the root of the crate containing
* the file (at filePath), or just filePath itself, if it's
* a standalone file
*/
export function getRootPath(filePath: string): string {
    let res;
    let parent = projects.getParent(filePath);
    if (parent !== undefined) {
        res = parent.path;
    } else {
        res = filePath;
    }
    return res;
}
