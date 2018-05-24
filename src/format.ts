import * as util from './util';
import { FormatMode } from './config';
import * as vscode from 'vscode';

// ========================================================
// Format Functions
// ========================================================

async function formatFile(rootPath: string, filePath: string, formatMode: FormatMode) {
    await util.spawn('rustfmt', [`--write-mode=${formatMode}`, `--config-path=${rootPath}`, filePath], { cwd: rootPath });
}

// ========================================================
// Format Management
// ========================================================

export async function hasPrerequisites(): Promise<boolean> {
    try {
        await util.spawn('rustfmt', [`--version`]);
        return true;
    } catch (error) {
        return false;
    }
}

export class FormatManager {
    private rootPaths: Array<string>;
    private formatMode: FormatMode;

    public constructor(rootPaths: Array<string>, formatMode: FormatMode) {
        this.rootPaths = rootPaths;
        this.formatMode = formatMode;
    }

    public async format(filePath: string) {
        let root = util.findMatchingRoot(this.rootPaths, filePath);
        if (root !== undefined) {
            await formatFile(root, filePath, this.formatMode);
        } else {
            vscode.window.showErrorMessage('Rust Assist: Unable to find root path for file, unable to format.');
        }
    }
}
