'use strict';

import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import * as locate_java_home from 'locate-java-home';

async function findJavaHome(): Promise<string | null> {
    return new Promise((resolve, reject) => {
        try {
            const options = {
                version: ">=1.8",
                mustBe64Bit: true
            };
            locate_java_home(options, (err, javaHomes) => {
                if (err) {
                    console.error(err.message);
                    resolve(null);
                } else {
                    const javaHome = javaHomes[0];
                    console.log("Using Java home", javaHome);
                    resolve(javaHome.path);
                }
            });
        }
        catch (err) {
            console.error(err.message);
            resolve(null);
        }
    });
}

function config(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration("prusti-assistant");
}

export enum VerificationMode {
    CurrentProgram,
    AllCratesInWorkspace
}

export function verificationMode(): VerificationMode {
    // Convert string to enum. See https://stackoverflow.com/a/17381004/2491528
    return VerificationMode[
        config().get("verificationMode", "CurrentProgram") as
        keyof typeof VerificationMode
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

export async function javaHome(): Promise<string> {
    return config().get("javaHome") || (await findJavaHome()) || "";
}

// Hardcoded values

export function prustiToolsUrl(): string | null {
    const platform = os.platform();
    switch (platform) {
        case "linux":
            return "http://viper.ethz.ch/downloads/PrustiToolsLinux.zip";
        case "win32":
            return "http://viper.ethz.ch/downloads/PrustiToolsWin.zip";
        case "darwin":
            return "http://viper.ethz.ch/downloads/PrustiToolsMac.zip";
        default:
            console.log(`"Unsupported platform: ${platform}`);
            return null;
    }
}

// Paths

export function exeExtension(): string {
    if (os.platform() === "win32") {
        return ".exe";
    } else {
        return "";
    }
}

export function prustiToolsZip(context: vscode.ExtensionContext): string {
    return path.join(context.globalStoragePath, "PrustiTools.zip");
}

export function prustiHome(context: vscode.ExtensionContext): string {
    return path.join(context.globalStoragePath, "prusti") ;
}

export function prustiDriverExe(context: vscode.ExtensionContext): string {
    return path.join(prustiHome(context), "prusti-driver" + exeExtension());
}

export function prustiRustcExe(context: vscode.ExtensionContext): string {
    return path.join(prustiHome(context), "prusti-rustc" + exeExtension());
}

export function cargoPrustiExe(context: vscode.ExtensionContext): string {
    return path.join(prustiHome(context), "cargo-prusti" + exeExtension());
}

export function viperHome(context: vscode.ExtensionContext): string {
    return path.join(prustiHome(context), "viper");
}

export function z3Exe(context: vscode.ExtensionContext): string {
    return path.join(prustiHome(context), "z3", "z3" + exeExtension());
}

export function boogieExe(context: vscode.ExtensionContext): string {
    return path.join(prustiHome(context), "boogie", "boogie" + exeExtension());
}
