import * as vscode from 'vscode';
import { Location } from 'vs-verification-toolbox';
import * as util from './util';
import { findJavaHome, JavaHome } from './javaHome';

const namespace = "prusti-assistant";

function config(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration(namespace);
}

export enum BuildChannel {
    // Stable = "stable",
    Nightly = "nightly",
    Local = "local"
}

const buildChannelKey = "buildChannel";
export const buildChannelPath = `${namespace}.${buildChannelKey}`;

export function buildChannel(): BuildChannel {
    const channelName = config().get(buildChannelKey, "nightly");
    const channel = BuildChannel[
        // Convert string to enum. See https://stackoverflow.com/a/17381004/2491528
        channelName as keyof typeof BuildChannel
    ];
    if (channel !== undefined) {
        return channel;
    } else {
        util.userError(`Prusti has no build channel named ${channelName}; defaulting to nightly`);
        return BuildChannel.Nightly;
    }
}

const localPrustiPathKey = "localPrustiPath";
export const localPrustiPathPath = `${namespace}.${localPrustiPathKey}`;

export function localPrustiPath(): string {
    return config().get(localPrustiPathKey, "");
}

export enum VerificationMode {
    CurrentProgram,
    AllCratesInWorkspace
}

export function verificationMode(): VerificationMode {
    const modeName = config().get("verificationMode", "CurrentProgram");
    const mode = VerificationMode[
        // Convert string to enum. See https://stackoverflow.com/a/17381004/2491528
        modeName as keyof typeof VerificationMode
    ];
    if (mode !== undefined) {
        return mode;
    } else {
        util.userError(`Prusti has no verification mode named ${modeName}; defaulting to "current program"`);
        return VerificationMode.CurrentProgram;
    }
}

export function verifyOnSave(): boolean {
    return config().get("verifyOnSave", true);
}

export function verifyOnOpen(): boolean {
    return config().get("verifyOnOpen", true);
}

export function reportErrorsOnly(): boolean {
    return config().get("reportErrorsOnly", true);
}

export async function javaHome(): Promise<JavaHome | null> {
    const configPath = config().get<string>("javaHome", "");
    const path = configPath.length > 0 ? configPath : await findJavaHome();
    if (path === null) { return null; }
    return new JavaHome(new Location(path));
}

const serverAddressKey = "serverAddress";
export const serverAddressPath = `${namespace}.${serverAddressKey}`;

export function serverAddress(): string {
    return config().get(serverAddressKey, "");
}
