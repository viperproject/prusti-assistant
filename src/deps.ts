import * as vscode from 'vscode';
import * as fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import * as config from './config';
import * as util from './util';
import * as notifier from './notifier';
import { Dependency, Location, FileDownloader, InstallerSequence, LocalReference, ZipExtractor, withProgressInWindow } from 'vs-verification-toolbox';

export async function installDependencies(context: vscode.ExtensionContext, shouldUpdate: boolean): Promise<PrustiLocation> {
    notifier.notify(notifier.Event.StartPrustiUpdate);

    try {
        const tools = prustiTools(currentPlatform!, context);
        const { result: location, didReportProgress } = await withProgressInWindow(
            `${shouldUpdate ? "Updating" : "Installing"} Prusti`,
            listener => tools.install(config.buildChannel(), shouldUpdate, listener)
        );
        const prusti = new PrustiLocation(location);

        // only notify user about success if we reported anything in between; otherwise there was nothing to be done.
        if (didReportProgress) {
            // TODO test when restart is necessary
            if (shouldUpdate) {
                util.userInfo("Prusti updated successfully. Please restart the IDE.", true, true);
            } else {
                util.userInfo("Prusti installed successfully.");
            }
        }

        return prusti;
    } catch (err) {
        util.userError(`Error installing Prusti: ${err}`);
        throw err;
    } finally {
        notifier.notify(notifier.Event.EndPrustiUpdate);
    }
}

export class PrustiLocation {
    constructor(
        private readonly location: Location
    ) {
        // Set execution flags (ignored on Windows)
        fs.chmodSync(this.prustiDriver, 0o775);
        fs.chmodSync(this.prustiRustc, 0o775);
        fs.chmodSync(this.cargoPrusti, 0o775);
        fs.chmodSync(this.z3, 0o775);
    }

    public get prustiDriver(): string {
        return this.location.executable("prusti-driver");
    }

    public get prustiRustc(): string {
        return this.location.executable("prusti-rustc");
    }

    public get cargoPrusti(): string {
        return this.location.executable("cargo-prusti");
    }

    public get z3(): string {
        return this.location.child("z3").executable("z3");
    }

    public get boogie(): string {
        return this.location.child("boogie").executable("boogie");
    }

    public get viperHome(): string {
        return this.location.path("viper");
    }
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

function prustiTools(platform: Platform, context: vscode.ExtensionContext): Dependency<config.BuildChannel> {
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

enum Platform {
    Linux,
    Windows,
    Mac,
}

export const currentPlatform: Platform | null = (() => {
    const platform = os.platform();
    switch (platform) {
        case "linux":
            return Platform.Linux;
        case "win32":
            return Platform.Windows;
        case "darwin":
            return Platform.Mac;
        default:
            console.log(`Unsupported platform: ${platform}`);
            return null;
    }
})();
