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

export async function getRootPath(): Promise<string> {
    let find = await vscode.workspace.findFiles('**/Cargo.toml');
    if (find.length > 0) {
        return find[0].fsPath.replace(/Cargo\.toml$/, '');
    }
    return vscode.workspace.rootPath || './';
}