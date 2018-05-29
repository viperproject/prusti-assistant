import * as util from './util';
import * as vscode from 'vscode';
import * as tmp from 'tmp';

// Get sysroot rustc --print sysroot

// ========================================================
// Completion Management
// ========================================================

export async function hasPrerequisites(): Promise<boolean> {
    try {
        await util.spawn('racer', [`--version`]);
        return true;
    } catch (error) {
        return false;
    }
}

export class CompletionManager {
    private tmpFile: string;

    public constructor() {
        tmp.setGracefulCleanup();
        let file = tmp.fileSync();
        this.tmpFile = file.name;
    }

    public getDocumentFilter(): vscode.DocumentFilter {
        return { language: 'rust', scheme: 'file' };
    }

    public getDefinitionProvider(): vscode.DefinitionProvider {
        return { provideDefinition: this.definitionProvider.bind(this) };
    }

    private definitionProvider(document: vscode.TextDocument, position: vscode.Position): Thenable<vscode.Definition | undefined> {
        const args = ['find-definition', (position.line + 1).toString(), position.character.toString(), document.fileName, this.tmpFile];
        return util.spawn('racer', args).then(output => {
            console.log(output.stdout);
            const lines = output.stdout.split('\n');
            if (lines.length === 0) {
                return undefined;
            }
            const result = lines[0];
            const parts = result.split('\t');
            const line = Number(parts[2]) - 1;
            const character = Number(parts[3]);
            const uri = vscode.Uri.file(parts[4]);
            return new vscode.Location(uri, new vscode.Position(line, character));
        });
    }
}


// // ====================================================
// // Completions
// // ====================================================

// completion.hasPrerequisites().then(result => {
//     if (result) {
//         const completionManager = new completion.CompletionManager();

//         context.subscriptions.push(
//             vscode.languages.registerDefinitionProvider(
//                 completionManager.getDocumentFilter(),
//                 completionManager.getDefinitionProvider()
//             )
//         );
//     } else {
//         vscode.window.showWarningMessage('Rust Assist: Racer not found on path, completions are disabled.');
//     }
// });