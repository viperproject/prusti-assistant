import * as vvt from "vs-verification-toolbox";
import * as path from "path";
import * as vscode from "vscode";

import * as config from "../config";

export async function prustiTools(
    platform: vvt.Platform,
    context: vscode.ExtensionContext
): Promise<vvt.Dependency<config.BuildChannel>> {
    const id = identifier(platform);
    const channel = config.BuildChannel;
    const stableUrl = await vvt.GitHubReleaseAsset.getLatestAssetUrl(
        "viperproject", "prusti-dev", `prusti-release-${id}.zip`
    );
    const nightlyUrl = await vvt.GitHubReleaseAsset.getLatestAssetUrl(
        "viperproject", "prusti-dev", `prusti-release-${id}.zip`, true
    );
    const headers = {
        "Accept": "application/octet-stream"
    };
    return new vvt.Dependency(
        path.join(context.globalStoragePath, "prustiTools"),
        [channel.Stable, new vvt.InstallerSequence([
            new vvt.FileDownloader(stableUrl, headers),
            new vvt.ZipExtractor("prusti"),
        ])],
        [channel.Nightly, new vvt.InstallerSequence([
            new vvt.FileDownloader(nightlyUrl, headers),
            new vvt.ZipExtractor("prusti"),
        ])],
        [channel.Local, new vvt.LocalReference(config.localPrustiPath())],
    );
}

function identifier(platform: vvt.Platform): string {
    switch (platform) {
        case vvt.Platform.Mac:
            return "macos";
        case vvt.Platform.Windows:
            return "windows";
        case vvt.Platform.Linux:
            return "ubuntu";
    }
}
