import * as childProcess from 'child_process';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export function userInfo(message: string, popup = true, requestReload = false) {
    log(message);
    vscode.window.setStatusBarMessage(message);
    if (popup) {
        if (requestReload) {
            const action = "Reload Now";
            vscode.window.showInformationMessage(message, action)
                .then(selection => {
                    if (selection === action) {
                        vscode.commands.executeCommand(
                            "workbench.action.reloadWindow"
                        );
                    }
                });
        } else {
            vscode.window.showInformationMessage(message);
        }
    }
}

export function userWarn(message: string, popup = true) {
    log(message);
    vscode.window.setStatusBarMessage(message);
    if (popup) {
        vscode.window.showWarningMessage(message);
    }
}

export function userError(message: string, popup = true, restart = false) {
    log(message);
    vscode.window.setStatusBarMessage(message);
    if (popup) {
        if (restart) {
            const action = "Restart Now";
            vscode.window.showInformationMessage(message, action)
                .then(selection => {
                    if (selection === action) {
                        vscode.commands.executeCommand(
                            "workbench.action.reloadWindow"
                        );
                    }
                });
        } else {
            vscode.window.showInformationMessage(message);
        }
    }
}

const logChannel = vscode.window.createOutputChannel("Prusti Assistant");
export function log(message: string) {
    console.log(message);
    logChannel.appendLine(message);
}

const traceChannel = vscode.window.createOutputChannel("Prusti Assistant Trace");
export function trace(message: string) {
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
): { output: Promise<Output>, kill: () => void } {
    log(`Prusti Assistant: Running '${cmd} ${args?.join(' ') ?? ''}'`);
    let stdout = '';
    let stderr = '';

    const proc = childProcess.spawn(cmd, args, options);

    proc.stdout.on('data', (data) => {
        stdout += data;
        try {
            onStdout?.(data);
        } catch (e) {
            log(`error in stdout handler for ${cmd}: ${e}`);
        }
    });
    proc.stderr.on('data', (data) => {
        stderr += data;
        try {
            onStderr?.(data);
        } catch (e) {
            log(`error in stderr handler for ${cmd}: ${e}`);
        }
    });

    function printOutput() {
        trace("");
        trace(`Output from ${cmd} (args: ${args})`);
        trace("┌──── Begin stdout ────┐");
        trace(stdout);
        trace("└──── End stdout ──────┘");
        trace("┌──── Begin stderr ────┐");
        trace(stderr);
        trace("└──── End stderr ──────┘");
    }

    return {
        output: new Promise((resolve, reject) => {
            proc.on('close', (code) => {
                printOutput();
                resolve({ stdout, stderr, code });
            });
            proc.on('error', (err) => {
                printOutput();
                console.log("Error", err);
                log(`Error: ${err}`);
                reject(err);
            });
        }),
        kill: proc.kill
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

    public hasProjects() {
        return this.projects.length > 0;
    }

    public getParent(file: string) {
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
    (await vscode.workspace.findFiles('**/Cargo.toml')).forEach((path: vscode.Uri) => {
        projects.push(new Project(path.fsPath.replace(/[/\\]?Cargo\.toml$/, '')));
    });
    return new ProjectList(projects);
}
