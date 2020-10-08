import * as childProcess from "child_process";
import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as treeKill from 'tree-kill';

export function userInfo(message: string, popup = true, requestReload = false, statusBar = true): void {
    log(message);
    if (statusBar) {
        vscode.window.setStatusBarMessage(message);
    }
    if (popup) {
        if (requestReload) {
            const action = "Reload Now";
            void vscode.window.showInformationMessage(message, action)
                .then(selection => {
                    if (selection === action) {
                        void vscode.commands.executeCommand(
                            "workbench.action.reloadWindow"
                        );
                    }
                });
        } else {
            void vscode.window.showInformationMessage(message);
        }
    }
}

export function userWarn(message: string, popup = true): void {
    log(message);
    vscode.window.setStatusBarMessage(message);
    if (popup) {
        void vscode.window.showWarningMessage(message);
    }
}

export function userError(message: string, popup = true, restart = false): void {
    log(message);
    vscode.window.setStatusBarMessage(message);
    if (popup) {
        if (restart) {
            userErrorPopup(message, "Restart Now", () => {
                void vscode.commands.executeCommand("workbench.action.reloadWindow");
            });
        } else {
            void vscode.window.showErrorMessage(message);
        }
    }
}

export function userErrorPopup(message: string, actionLabel: string, action: () => void): void {
    log(message);
    vscode.window.setStatusBarMessage(message);
    void vscode.window.showErrorMessage(message, actionLabel)
        .then(selection => {
            if (selection === actionLabel) {
                action();
            }
        });
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

export interface Output {
    stdout: string;
    stderr: string;
    code: number;
}

export function spawn(
    cmd: string,
    args?: string[] | undefined,
    { options, onStdout, onStderr }: {
        options?: childProcess.SpawnOptionsWithoutStdio | undefined;
        onStdout?: ((data: string) => void) | undefined;
        onStderr?: ((data: string) => void) | undefined;
    } = {}
): { output: Promise<Output>; kill: () => void } {
    const description = `${cmd} ${args?.join(" ") ?? ""}`;
    log(`Prusti Assistant: run '${description}'`);

    let stdout = "";
    let stderr = "";

    const proc = childProcess.spawn(cmd, args, options);

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

    function printOutput() {
        trace("");
        trace(`Output from '${description}'`);
        trace("┌──── Begin stdout ────┐");
        trace(stdout);
        trace("└──── End stdout ──────┘");
        trace("┌──── Begin stderr ────┐");
        trace(stderr);
        trace("└──── End stderr ──────┘");
    }

    return {
        output: new Promise((resolve, reject) => {
            proc.on("close", (code) => {
                printOutput();
                resolve({ stdout, stderr, code });
            });
            proc.on("error", (err) => {
                printOutput();
                log(`Error: ${err}`);
                reject(err);
            });
        }),
        kill: () => {
            treeKill(proc.pid, "SIGKILL", (err) => {
                if (err !== undefined) {
                    console.error(err);
                    log(`Failed to kill process tree of ${proc.pid}: ${err}`);
                    const succeeded = proc.kill("SIGKILL");
                    if (!succeeded) {
                        log(`Failed to kill process ${proc}`);
                    }
                }
            });
        }
    };
}

export class Project {
    public constructor(
        readonly path: string
    ) { }

    public hasRootFile(fileName: string): Promise<boolean> {
        const filePath = path.join(this.path, fileName);
        return new Promise((resolve, reject) => {
            fs.access(filePath, fs.constants.F_OK, (err) => resolve(err === null));
        });
    }
}

export class ProjectList {
    public constructor(
        readonly projects: Project[]
    ) { }

    public hasProjects(): boolean {
        return this.projects.length > 0;
    }

    public getParent(file: string): Project | undefined {
        for (const project of this.projects) {
            if (file.startsWith(project.path)) {
                return project;
            }
        }
        return undefined;
    }
}

/**
 * Find all projects in the workspace that contain a Cargo.toml file.
 *
 * @returns A project list.
 */
export async function findProjects(): Promise<ProjectList> {
    const projects: Project[] = [];
    (await vscode.workspace.findFiles("**/Cargo.toml")).forEach((path: vscode.Uri) => {
        projects.push(new Project(path.fsPath.replace(/[/\\]?Cargo\.toml$/, "")));
    });
    return new ProjectList(projects);
}
