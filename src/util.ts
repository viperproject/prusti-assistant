import * as child_process from 'child_process';
import * as vscode from 'vscode';

export interface Output {
    stdout: string;
    stderr: string;
    code: number;
}

export function spawn(
    cmd: string,
    args?: string[],
    options?: child_process.SpawnOptions
): Promise<Output> {
    return new Promise((resolve, reject) => {
        let stdout = '';
        let stderr = '';

        const proc = child_process.spawn(cmd, args, options);

        proc.stdout.on('data', (data) => stdout += data);
        proc.stderr.on('data', (data) => stderr += data);
        proc.on('close', (code) => resolve({ stdout, stderr, code }));
        proc.on('error', (err) => reject(err));
    });
}

export async function getRootPaths(): Promise<Array<string>> {
    let roots: Array<string> = [];
    (await vscode.workspace.findFiles('**/Cargo.toml')).forEach(path => {
        roots.push(path.fsPath.replace(/Cargo\.toml$/, ''));
    });
    if (roots.length === 0) {
        roots.push(vscode.workspace.rootPath || './');
    }
    return roots;
}