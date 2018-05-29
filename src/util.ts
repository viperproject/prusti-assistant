import * as child_process from 'child_process';
import * as vscode from 'vscode';

export interface Output {
    stdout: string;
    stderr: string;
    code: number;
}

export function spawn(
    cmd: string,
    args?: Array<string>,
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

/**
 * Find all paths in the workspace that contain a Cargo.toml file.
 * 
 * @returns An array of paths.
 */
export async function findRootPaths(): Promise<Array<string>> {
    let roots: Array<string> = [];
    (await vscode.workspace.findFiles('**/Cargo.toml')).forEach(path => {
        roots.push(path.fsPath.replace(/[/\\]?Cargo\.toml$/, ''));
    });
    return roots;
}

export function findMatchingRoot(roots: Array<string>, key: string) {
    for (const root of roots) {
        if (key.startsWith(root)) {
            return root;
        }
    }
    return undefined;
}