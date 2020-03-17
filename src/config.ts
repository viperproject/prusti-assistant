'use strict';

import * as vscode from 'vscode';
import * as os from 'os';
import * as locate_java_home from 'locate-java-home';

async function findJavaHome(): Promise<string | null> {
    return new Promise((resolve, reject) => {
        try {
            const options = {
                version: ">=1.8",
                mustBe64Bit: true
            };
            console.log("Searching for Java home...");
            locate_java_home.default(options, (err, javaHomes) => {
                if (err) {
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

export function exeExtension(): string {
    return os.platform() === "win32" ? ".exe" : "";
}
