import { Platform, Dependency, RemoteZipExtractor, LocalReference } from "vs-verification-toolbox";
import * as path from "path";
import * as vscode from "vscode";

import * as config from "../config";

export function prustiTools(platform: Platform, context: vscode.ExtensionContext): Dependency<config.BuildChannel> {
    const id = identifier(platform);
    const channel = config.BuildChannel;
    return new Dependency(
        path.join(context.globalStoragePath, "prustiTools"),
        [channel.Stable, new RemoteZipExtractor(`https://github.com/viperproject/prusti-dev/releases/download/v-2020-07-27-1200/prusti-release-${id}.zip`)],
        [channel.Nightly, new RemoteZipExtractor(`https://github.com/viperproject/prusti-dev/releases/latest/download/prusti-release-${id}.zip`)],
        [channel.Local, new LocalReference(config.localPrustiPath())],
    );
}

function identifier(platform: Platform): string {
    switch (platform) {
        case Platform.Mac:
            return "macos";
        case Platform.Windows:
            return "windows";
        case Platform.Linux:
            return "ubuntu";
    }
}
