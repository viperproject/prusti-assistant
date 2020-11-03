import * as vvt from "vs-verification-toolbox";
import * as path from "path";
import * as vscode from "vscode";
import * as process from "process";
import * as config from "../config";

export function prustiTools(
    platform: vvt.Platform,
    context: vscode.ExtensionContext
): vvt.Dependency<config.BuildChannel> {
    const id = identifier(platform);
    const channel = config.BuildChannel;
    const getReleaseUrl = (): Promise<string> => {
        const url = vvt.GitHubReleaseAsset.getLatestAssetUrl(
            "viperproject", "prusti-dev", `prusti-release-${id}.zip`,
            false,
            // Avoid rate limit while testing
            process.env.GITHUB_TOKEN,
        );
        return url;
    }
    const getDevUrl = (): Promise<string> => {
        const url = vvt.GitHubReleaseAsset.getLatestAssetUrl(
            "viperproject", "prusti-dev", `prusti-release-${id}.zip`,
            true,
            // Avoid rate limit while testing
            process.env.GITHUB_TOKEN,
        );
        return url;
    }
    return new vvt.Dependency(
        path.join(context.globalStoragePath, "prustiTools"),
        [channel.LatestRelease, new vvt.GitHubZipExtractor(getReleaseUrl, "prusti")],
        [channel.LatestDev, new vvt.GitHubZipExtractor(getDevUrl, "prusti")],
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
