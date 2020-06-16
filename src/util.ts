import * as childProcess from 'child_process';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { utils } from 'mocha';

export function userInfo(message: string, popup = true, restart = false) {
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

let _channel: vscode.OutputChannel;
export function log(message: string) {
    console.log(message);
    if (_channel === undefined) {
        _channel = vscode.window.createOutputChannel("Prusti Assistant");
    }
    _channel.appendLine(message);
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
): Promise<Output> {
    log(`Prusti Assistant: Running '${cmd} ${args?.join(' ') ?? ''}'`);
    return new Promise((resolve, reject) => {
        let stdout = '';
        let stderr = '';

        const proc = childProcess.spawn(cmd, args, options);

        proc.stdout.on('data', (data) => {
            stdout += data;
            onStdout?.(data);
        });
        proc.stderr.on('data', (data) => {
            stderr += data;
            onStderr?.(data);
        });

        proc.on('close', (code) => {
            log("┌──── Begin stdout ────┐");
            log(stdout);
            log("└──── End stdout ──────┘");
            log("┌──── Begin stderr ────┐");
            log(stderr);
            log("└──── End stderr ──────┘");
            resolve({ stdout, stderr, code });
        });
        proc.on('error', (err) => {
            log("┌──── Begin stdout ────┐");
            log(stdout);
            log("└──── End stdout ──────┘");
            log("┌──── Begin stderr ────┐");
            log(stderr);
            log("└──── End stderr ──────┘");
            console.log("Error", err);
            log(`Error: ${err}`);
            reject(err);
        });
    });
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
