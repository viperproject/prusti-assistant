import * as vscode from 'vscode';

function config(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration("prusti-assistant");
}

export function prustiHome(): string {
    return config().get("prustiHome", "");
}

export function verifyOnSave(): boolean {
    return config().get("verifyOnSave", true);
}

export function verifyOnStartup(): boolean {
    return config().get("verifyOnStartup", true);
}

export function reportErrorsOnly(): boolean {
    return config().get("reportErrorsOnly", true);
}

export function javaHome(): string {
    return config().get("javaHome") || process.env.JAVA_HOME || "";
}

export function viperHome(): string {
    return config().get("viperHome") || process.env.VIPER_HOME || "";
}

export function z3Exe(): string {
    return config().get("z3Exe") || process.env.Z3_EXE || "z3";
}

export function boogieExe(): string {
    return config().get("boogieExe") || process.env.BOOGIE_EXE || "boogie";
}
