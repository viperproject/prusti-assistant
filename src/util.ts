import * as child_process from 'child_process';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

let _channel: vscode.OutputChannel;
export function log(message: string) {
    if (!_channel) {
        _channel = vscode.window.createOutputChannel('Prusti Assistant');
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
    args?: Array<string> | undefined,
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
            log("===== Begin stdout =====");
            log(stdout);
            log("===== End stdout =====");
            log("===== Begin stderr =====");
            log(stderr);
            log("===== End stderr =====");
            resolve({ stdout, stderr, code });
        });
        proc.on('error', (err) => {
            log("===== Begin stdout =====");
            log(stdout);
            log("===== End stdout =====");
            log("===== Begin stderr =====");
            log(stderr);
            log("===== End stderr =====");
            console.log(err);
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
        let filePath = path.join(this._path, fileName);
        return new Promise((resolve, reject) => {
            fs.access(filePath, fs.constants.F_OK, (err) => resolve(err ? false : true));
        });
    }
}

export class ProjectList {
    private _projects: Array<Project>;

    public constructor(projects: Array<Project>) {
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
    let projects: Array<Project> = [];
    (await vscode.workspace.findFiles('**/Cargo.toml')).forEach((path: any) => {
        projects.push(new Project(path.fsPath.replace(/[/\\]?Cargo\.toml$/, '')));
    });
    return new ProjectList(projects);
}