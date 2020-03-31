import { Platform, Dependency, FileDownloader, InstallerSequence, LocalReference, ZipExtractor } from 'vs-verification-toolbox';
import * as path from 'path';
import * as vscode from 'vscode';

import * as config from '../config';

export function prustiTools(platform: Platform, context: vscode.ExtensionContext): Dependency<config.BuildChannel> {
    const id = identifier(platform);
    function zipInstaller(url: string): InstallerSequence {
        return new InstallerSequence([
            new FileDownloader(url),
            new ZipExtractor("prusti"),
        ]);
    }

    const channel = config.BuildChannel;
    return new Dependency(
        path.join(context.globalStoragePath, "prusti"),
        [channel.Stable, zipInstaller(`http://viper.ethz.ch/downloads/PrustiTools${id}.zip`)],
        [channel.Nightly, zipInstaller(`http://viper.ethz.ch/downloads/nightly/PrustiTools${id}.zip`)],
        [channel.Local, new LocalReference(config.localPrustiPath())],
    );
}

function identifier(platform: Platform): string {
    switch (platform) {
        case Platform.Mac:
            return "Mac";
        case Platform.Windows:
            return "Win";
        case Platform.Linux:
            return "Linux";
    }
}
