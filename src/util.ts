import * as child_process from 'child_process';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import * as extract_zip from 'extract-zip';

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
    if (!_channel) {
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
    options?: child_process.SpawnOptionsWithoutStdio | undefined
): Promise<Output> {
    log(`Prusti Assistant: Running '${cmd} ${args ? args.join(' ') : ''}'`);
    return new Promise((resolve, reject) => {
        let stdout = '';
        let stderr = '';

        const proc = child_process.spawn(cmd, args, options);

        proc.stdout.on('data', (data) => stdout += data);
        proc.stderr.on('data', (data) => stderr += data);
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
    private _path: string;

    public constructor(path: string) {
        this._path = path;
    }

    public get path() {
        return this._path;
    }

    public hasRootFile(fileName: string): Promise<boolean> {
        const filePath = path.join(this._path, fileName);
        return new Promise((resolve, reject) => {
            fs.access(filePath, fs.constants.F_OK, (err) => resolve(err ? false : true));
        });
    }
}

export class ProjectList {
    private _projects: Project[];

    public constructor(projects: Project[]) {
        this._projects = projects;
    }

    public get projects() {
        return this._projects;
    }

    public hasProjects() {
        return this._projects.length > 0;
    }

    public getParent(file: string) {
        for (const project of this._projects) {
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

export async function download(url: string, filePath: string): Promise<[boolean, string | null]> {
    return new Promise((resolve, reject) => {
        try {
            const file = fs.createWriteStream(filePath);
            const request = http.get(url, (response) => {
                response.pipe(file);
                file.on("finish", () => {
                    file.close();
                    resolve([true, null]);
                });
                request.on("error", (err) => {
                    fs.unlink(filePath, (_) => {
                        log("Could not remove downloaded file.");
                    });
                    resolve([false, err.message]);
                });
            });
        }
        catch (err) {
            resolve([false, err.message]);
        }
    });
}

export async function extract(filePath: string, targetDir: string): Promise<[boolean, string | null]> {
    return new Promise((resolve, reject) => {
        try {
            extract_zip(filePath, { dir: targetDir }, (err) => {
                if (err) {
                    resolve([false, err.message]);
                } else {
                    resolve([true, null]);
                }
            });
        }
        catch (err) {
            resolve([false, err.message]);
        }
    });
}
