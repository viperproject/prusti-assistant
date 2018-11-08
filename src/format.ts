import * as util from './util';
import { FormatMode } from './config';
import * as vscode from 'vscode';

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
    private formatMode: FormatMode;

    public constructor(formatMode: FormatMode) {
        this.formatMode = formatMode;
    }

    public async formatFile(project: util.Project | undefined, filePath: string) {
        if (project !== undefined) {
            let args = [];
            if (await project.hasRootFile('rustfmt.toml')) {
                args.push(`--config-path=${project.path}`);
            }
            if (this.formatMode === FormatMode.Backup) {
                args.push('--backup');
            }
            args.push(filePath);

            const result = await util.spawn('rustfmt', args, { cwd: project.path });

            if (result.stderr) {
                vscode.window.showErrorMessage(`Rust Assist: Format error. ${result.stderr}`);
            }
        } else {
            vscode.window.showErrorMessage('Rust Assist: Unable to find root path for file, unable to format.');
        }
    }
}
