import * as vvt from "vs-verification-toolbox";
import * as path from "path";
import * as vscode from "vscode";
import * as process from "process";
import * as fs from "fs-extra";
import * as config from "../config";

export async function prustiTools(
    platform: vvt.Platform,
    context: vscode.ExtensionContext
): Promise<vvt.Dependency<config.PrustiVersion>> {
    const id = identifier(platform);
    const version = config.PrustiVersion;

    // Token used to avoid rate limits while testing
    const authorization_token = process.env.GITHUB_TOKEN
    if (authorization_token) {
        console.info("Using authorization token");
    }

    // Get the latest among releases and pre-releases
    const getLatestReleaseUrl = (): Promise<string> => {
        return vvt.GitHubReleaseAsset.getLatestAssetUrl(
            "viperproject", "prusti-dev", `prusti-release-${id}.zip`, true, authorization_token,
        );
    }

    const getTaggedReleaseUrl = (): Promise<string> => {
        const tag = config.prustiTag();
        return vvt.GitHubReleaseAsset.getTaggedAssetUrl(
            "viperproject", "prusti-dev", `prusti-release-${id}.zip`, tag, authorization_token,
        );
    }

    if (config.prustiVersion() == config.PrustiVersion.Local
          && !await fs.pathExists(config.localPrustiPath())) {
        throw new Error(
            `In the settings the Prusti version is ${config.PrustiVersion.Local}, but the `
            + `specified local path '${config.localPrustiPath()}' does not exist.`
        );
    }

    if (config.prustiVersion() == config.PrustiVersion.Tag && !config.prustiTag()) {
        throw new Error(
            `In the settings the Prusti version is ${config.PrustiVersion.Tag}, but `
            + `no tag has been provided. Please specify it in the prustiTag field.`
        );
    }

    return new vvt.Dependency(
        path.join(context.globalStoragePath, "prustiTools"),
        [version.Latest, new vvt.GitHubZipExtractor(getLatestReleaseUrl, "prusti", authorization_token)],
        [version.Tag, new vvt.GitHubZipExtractor(getTaggedReleaseUrl, "prusti", authorization_token)],
        [version.Local, new vvt.LocalReference(config.localPrustiPath())],
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
