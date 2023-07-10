import * as vscode from "vscode";
import { Location } from "vs-verification-toolbox";
import * as util from "./util";
import { findJavaHome, JavaHome } from "./javaHome";

const namespace = "prusti-assistant";

export function config(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration(namespace);
}

export enum BuildChannel {
    LatestRelease = "LatestRelease",
    LatestDev = "LatestDev",
    Local = "Local"
}

export const buildChannelKey = "buildChannel";
export const buildChannelPath = `${namespace}.${buildChannelKey}`;

export function buildChannel(): BuildChannel {
    const defaultChannel = BuildChannel.LatestRelease;
    const channelName = config().get(buildChannelKey, defaultChannel as string);
    const channel = BuildChannel[
        // Convert string to enum. See https://stackoverflow.com/a/17381004/2491528
        channelName as keyof typeof BuildChannel
    ];
    if (channel !== undefined) {
        return channel;
    } else {
        util.userError(
            `Prusti has no build channel named ${channelName}; defaulting to ${defaultChannel}. ` +
            "This has been probably caused by an update of the extension. " +
            "To fix this error, please choose a valid build channel in the settings."
        );
        return defaultChannel;
    }
}

const localPrustiPathKey = "localPrustiPath";
export const localPrustiPathPath = `${namespace}.${localPrustiPathKey}`;

export function localPrustiPath(): string {
    return config().get(localPrustiPathKey, "");
}

export function checkForUpdates(): boolean {
    return config().get("checkForUpdates", true);
}

export function verifyOnSave(): boolean {
    return config().get("verifyOnSave", true);
}

export function verifyOnOpen(): boolean {
    return config().get("verifyOnOpen", true);
}

export function reportErrorsOnly(): boolean {
    return config().get("reportErrorsOnly", false);
}

// Avoid calling `findJavaHome()` each time.
let cachedFindJavaHome: string | null = null;

export async function javaHome(): Promise<JavaHome | null> {
    const configPath = config().get<string>("javaHome", "");
    let path;
    if (configPath.length > 0) {
        path = configPath;
    } else {
        if (cachedFindJavaHome === null) {
            cachedFindJavaHome = await findJavaHome();
        }
        path = cachedFindJavaHome;
    }
    if (path === null) { return null; }
    return new JavaHome(new Location(path));
}

const serverAddressKey = "serverAddress";
export const serverAddressPath = `${namespace}.${serverAddressKey}`;

export function serverAddress(): string {
    return config().get(serverAddressKey, "");
}

export function extraPrustiEnv(): Record<string, string> {
    return config().get("extraPrustiEnv", {});
}

export function extraPrustiRustcArgs(): string[] {
    return config().get("extraPrustiRustcArgs", []);
}

export function extraCargoPrustiArgs(): string[] {
    return config().get("extraCargoPrustiArgs", []);
}

export function extraPrustiServerArgs(): string[] {
    return config().get("extraPrustiServerArgs", []);
}

export function contractsAsDefinitions(): boolean {
    return config().get("contractsAsDefinitions", false);
}

export function reportViperMessages(): boolean {
    return config().get("reportViperMessages", true);
}

export function z3QiProfileFreq(): number {
    return config().get("z3QiProfileFreq", 100);
}
