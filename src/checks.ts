'use strict';

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as util from './util';
import * as config from './config';
import * as path from 'path';

export async function hasDependencies(context: vscode.ExtensionContext): Promise<boolean> {
    return fs.existsSync(config.prustiRustcExe(context));
}

export async function hasPrerequisites(context: vscode.ExtensionContext): Promise<[boolean, string]> {
    util.log("Checking Java home...");
    if (! await config.javaHome()) {
        const msg = (
            "[Prusti] Could not find Java home. Please install Java 1.8+ " +
            "64bit or set the 'javaHome' setting, then restart the IDE."
        );
        return [false, msg];
    }
    util.log("Checking Rustup and Cargo...");
    try {
        await util.spawn("rustup", ["--version"]);
        await util.spawn("cargo", ["--version"]);
    } catch (err) {
        console.error(err);
        util.log(`Error: ${err}`);
        const msg = (
            "[Prusti] Could not run Rustup. Please visit https://rustup.rs/ " +
            "and install Rustup, then restart the IDE."
        );
        return [false, msg];
    }
    util.log("Checking Java...");
    try {
        const javaPath = path.join(
            await config.javaHome(),
            "bin",
            "java" + config.exeExtension()
        );
        await util.spawn(javaPath, ["-version"]);
    } catch (err) {
        console.error(err);
        util.log(`Error: ${err}`);
        const msg = (
            "[Prusti] Could not run Java. Please install Java 1.8+ 64bit, " +
            "then restart the IDE."
        );
        return [false, msg];
    }
    util.log("Checking Z3...");
    try {
        await util.spawn(config.z3Exe(context), ["--version"]);
    } catch (err) {
        console.error(err);
        util.log(`Error: ${err}`);
        const msg = (
            "[Prusti] Could not run Z3. Please try updating the dependencies, " +
            "then restart the IDE."
        );
        return [false, msg];
    }
    util.log("Checking Prusti...");
    try {
        await util.spawn(config.prustiRustcExe(context), ["--version"]);
    } catch (err) {
        console.error(err);
        util.log("Could not run prusti-rustc");
        util.log(`Error: ${err}`);
        const msg = (
            "Could not run Prusti. Please try updating the dependencies, " +
            "then restart the IDE."
        );
        return [false, msg];
    }
    util.log("Checking Cargo-Prusti...");
    try {
        await util.spawn(config.cargoPrustiExe(context), ["--help"]);
    } catch (err) {
        console.error(err);
        util.log("Could not run cargo-prusti");
        util.log(`Error: ${err}`);
        const msg = (
            "Could not run Prusti. Please try updating the dependencies, " +
            "then restart the IDE."
        );
        return [false, msg];
    }
    return [true, ""];
}
