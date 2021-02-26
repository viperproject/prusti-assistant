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

    // Token used to avoid rate limits while testing
    const authorization_token = process.env.GITHUB_TOKEN
    if (authorization_token) {
        console.log("Using authorization token");
    }

    const getReleaseUrl = (): Promise<string> => {
        return vvt.GitHubReleaseAsset.getLatestAssetUrl(
            "viperproject", "prusti-dev", `prusti-release-${id}.zip`,
            false,
            authorization_token,
        );
    }
    const getDevUrl = (): Promise<string> => {
        return vvt.GitHubReleaseAsset.getLatestAssetUrl(
            "viperproject", "prusti-dev", `prusti-release-${id}.zip`,
            true,
            authorization_token,
        );
    }
    return new vvt.Dependency(
        path.join(context.globalStoragePath, "prustiTools"),
        [channel.LatestRelease, new vvt.GitHubZipExtractor(getReleaseUrl, "prusti", authorization_token)],
        [channel.LatestDev, new vvt.GitHubZipExtractor(getDevUrl, "prusti", authorization_token)],
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
