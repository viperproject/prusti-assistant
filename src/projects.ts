import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";

class Project {
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

class ProjectList {
    private projects: Project[];

    public constructor(projects: Project[]) {
        this.projects = projects;
    }

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

    public async update(): Promise<void> {
        const projects: Project[] = [];
        (await vscode.workspace.findFiles("**/Cargo.toml")).forEach((uri: vscode.Uri) => {
            projects.push(new Project(uri.fsPath.replace(/[/\\]?Cargo\.toml$/, "")));
        });
        projects.sort((a, b) => {
            if (a.path > b.path) { return 1; }
            if (a.path < b.path) { return -1; }
            return 0;
        });
        this.projects = projects;
    }
}

export const projects = new ProjectList([]);
