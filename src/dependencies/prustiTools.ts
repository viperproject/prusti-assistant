import * as vvt from "vs-verification-toolbox";
import * as path from "path";
import * as vscode from "vscode";

import * as config from "../config";
import * as util from "../util";

export function prustiTools(
    platform: vvt.Platform,
    context: vscode.ExtensionContext
): vvt.Dependency<config.BuildChannel> {
    const id = identifier(platform);
    const channel = config.BuildChannel;
    const getStableUrl = (): Promise<string> => {
        const url = vvt.GitHubReleaseAsset.getLatestAssetUrl(
            "viperproject", "prusti-dev", `prusti-release-${id}.zip`
        );
        return url;
    }
    const getNightlyUrl = (): Promise<string> => {
        const url = vvt.GitHubReleaseAsset.getLatestAssetUrl(
            "viperproject", "prusti-dev", `prusti-release-${id}.zip`, true
        );
        return url;
    }
    return new vvt.Dependency(
        path.join(context.globalStoragePath, "prustiTools"),
        [channel.Stable, new vvt.GitHubZipExtractor(getStableUrl, "prusti")],
        [channel.Nightly, new vvt.GitHubZipExtractor(getNightlyUrl, "prusti")],
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
