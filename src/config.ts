import * as vscode from 'vscode';
import * as locate_java_home from 'locate-java-home';
import { Location } from 'vs-verification-toolbox';

async function findJavaHome(): Promise<string | null> {
    return new Promise((resolve, reject) => {
        try {
            const options = {
                version: ">=1.8",
                mustBe64Bit: true
            };
            console.log("Searching for Java home...");
            locate_java_home.default(options, (err, javaHomes) => {
                if (err !== null) {
                    console.error(err.message);
                    resolve(null);
                } else {
                    if (!Array.isArray(javaHomes) || javaHomes.length === 0) {
                        console.log("Could not find Java home");
                        resolve(null);
                    } else {
                        const javaHome = javaHomes[0];
                        console.log("Using Java home", javaHome);
                        resolve(javaHome.path);
                    }
                }
            });
        }
        catch (err) {
            console.error(err.message);
            resolve(null);
        }
    });
}

const namespace = "prusti-assistant";

function config(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration(namespace);
}

export enum BuildChannel {
    Stable = "stable",
    Nightly = "nightly",
    Local = "local"
}

const buildChannelKey = "buildChannel";
export const buildChannelPath = `${namespace}.${buildChannelKey}`;

export function buildChannel(): BuildChannel {
    // Convert string to enum. See https://stackoverflow.com/a/17381004/2491528
    return BuildChannel[
        config().get(buildChannelKey, "stable") as keyof typeof BuildChannel
    ];
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
    return VerificationMode[
        config().get("verificationMode", "CurrentProgram") as keyof typeof VerificationMode
    ];
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

export class JavaHome {
    constructor(
        private readonly location: Location
    ) { }

    public get path(): string {
        return this.location.basePath;
    }

    public get javaExecutable(): string {
        return this.location.child("bin").executable("java");
    }
}

const serverAddressKey = "serverAddress";
export const serverAddressPath = `${namespace}.${serverAddressKey}`;

export function serverAddress(): string {
    return config().get(serverAddressKey, "");
}
