import { Platform, Dependency, RemoteZipExtractor, LocalReference, GitHubReleaseAsset } from "vs-verification-toolbox";
import * as path from "path";
import * as vscode from "vscode";

import * as config from "../config";

export async function prustiTools(
    platform: Platform,
    context: vscode.ExtensionContext
): Promise<Dependency<config.BuildChannel>> {
    const id = identifier(platform);
    const channel = config.BuildChannel;
    const stableUrl = await GitHubReleaseAsset.getLatestAssetUrl(
        "viperproject", "prusti-dev", `prusti-release-${id}.zip`
    );
    const nightlyUrl = await GitHubReleaseAsset.getLatestAssetUrl(
        "viperproject", "prusti-dev", `prusti-release-${id}.zip`, true
    );
    return new Dependency(
        path.join(context.globalStoragePath, "prustiTools"),
        [channel.Stable, new RemoteZipExtractor(stableUrl)],
        [channel.Nightly, new RemoteZipExtractor(nightlyUrl)],
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
