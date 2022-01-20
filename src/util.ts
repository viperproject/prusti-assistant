import * as childProcess from "child_process";
import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as treeKill from "tree-kill";

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

export function userInfoPopup(message: string, actionLabel: string, action: () => void, statusBar?: vscode.StatusBarItem): void {
    log(message);
    if (statusBar) {
        statusBar.text = message;
    }
    vscode.window.showInformationMessage(message, actionLabel)
        .then(selection => {
            if (selection === actionLabel) {
                action();
            }
        })
        .then(undefined, err => log(`Error: ${err}`));
}

const logChannel = vscode.window.createOutputChannel("Prusti Assistant");
export function log(message: string): void {
    console.log(message);
    logChannel.appendLine(message);
    trace(message);
}

const traceChannel = vscode.window.createOutputChannel("Prusti Assistant Trace");
export function trace(message: string): void {
    traceChannel.appendLine(message);
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
            treeKill(proc.pid, "SIGTERM", (err) => {
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
        trace("");
        trace(`Output from '${description}' (${durationSecMsg}s):`);
        trace("┌──── Begin stdout ────┐");
        trace(stdout);
        trace("└──── End stdout ──────┘");
        trace("┌──── Begin stderr ────┐");
        trace(stderr);
        trace("└──── End stderr ──────┘");
        trace(`Exit code ${code}, signal ${signal}.`);
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

export class Project {
    readonly path;

    public constructor(_path: string) {
        this.path = _path;
    }

    public hasRootFile(fileName: string): Promise<boolean> {
        const filePath = path.join(this.path, fileName);
        return new Promise(resolve => {
            fs.access(filePath, fs.constants.F_OK, (err) => resolve(err === null));
        });
    }
}

export class ProjectList {
    public constructor(readonly projects: Project[]) {}

    public isEmpty(): boolean {
        return this.projects.length === 0;
    }

    public getParent(file: string): Project | undefined {
        let result: Project | undefined;
        // Find the last (innermost) project that contains the file.
        for (const project of this.projects) {
            if (file.startsWith(project.path)) {
                result = project;
            }
        }
        return result;
    }
}

/**
 * Find all projects in the workspace that contain a Cargo.toml file.
 *
 * @returns A project list.
 */
export async function findProjects(): Promise<ProjectList> {
    const projects: Project[] = [];
    (await vscode.workspace.findFiles("**/Cargo.toml")).forEach((uri: vscode.Uri) => {
        projects.push(new Project(uri.fsPath.replace(/[/\\]?Cargo\.toml$/, "")));
    });
    projects.sort((a, b) => {
        if (a.path > b.path) { return 1; }
        if (a.path < b.path) { return -1; }
        return 0;
    });
    return new ProjectList(projects);
}

/**
 * Given a file in a crate, get the crate reference
 *
 * @returns The Project crate or undefined.
 */
 export async function getCratePath(file: string): Promise<Project | undefined> {
    const projects = await findProjects();
    return projects.getParent(file);
}

export function getCachePath(context: vscode.ExtensionContext): string {
    return path.join(context.globalStoragePath, "cache.json")
}
