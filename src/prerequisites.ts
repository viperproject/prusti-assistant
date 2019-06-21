'use strict';

import * as util from './util';
import * as config from './config';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export async function hasPrerequisites(): Promise<boolean> {
    try {
        await util.spawn("rustup", ["--version"]);
    } catch (err) {
        console.error(err);
        util.log(`Error: ${err}`);
        vscode.window.showErrorMessage(
            "Rustup is not installed on this computer. \
            Please visit https://rustup.rs/ and install it, then restart the IDE."
        );
        return false;
    }
    try {
        await util.spawn("java", ["-version"]);
    } catch (err) {
        console.error(err);
        util.log(`Error: ${err}`);
        vscode.window.showErrorMessage(
            "Java is not installed on this computer. \
            Please install the 64bit version, then restart the IDE."
        );
        return false;
    }
    if (!config.cargoPrustiPath()) {
        vscode.window.showErrorMessage(
            "Prusti's path is empty. Please fix the 'cargoPrustiPath' setting"
        );
        return false;
    }
    try {
        const exists = fs.existsSync(config.cargoPrustiPath());
        if (!exists) {
            vscode.window.showErrorMessage(
                "Prusti's path does not point to a valid file. Please fix the 'cargoPrustiPath' setting."
            );
            return false;
        }
    } catch (err) {
        console.error(err);
        util.log(`Error: ${err}`);
        vscode.window.showErrorMessage(
            "Prusti's path looks wrong. Please check the 'cargoPrustiPath' setting."
        );
        return false;
    }
    try {
        await util.spawn(config.cargoPrustiPath(), ["--help"]);
    } catch (err) {
        console.error(err);
        util.log(`Error: ${err}`);
        vscode.window.showErrorMessage(
            "Prusti's path looks wrong. Please check the 'cargoPrustiPath' setting."
        );
        return false;
    }
    return true;
}
