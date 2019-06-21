'use strict';

import * as util from './util';
import * as config from './config';
import * as path from 'path';

export async function hasPrerequisites(): Promise<[boolean, string]> {
    if (!config.prustiHome()) {
        const msg = (
            "Could not find Prusti home. Please set the 'prustiHome' " +
            "setting, then restart the IDE."
        );
        return [false, msg];
    }
    if (!config.javaHome()) {
        const msg = (
            "Could not find Java home. Please set the 'javaHome' setting or " +
            "the JAVA_HOME environment variable, then restart the IDE."
        );
        return [false, msg];
    }
    if (!config.viperHome()) {
        const msg = (
            "Could not find Viper home. Please set the 'viperHome' setting " +
            "or the VIPER_HOME environment variable, then restart the IDE."
        );
        return [false, msg];
    }
    if (!config.z3Exe()) {
        const msg = (
            "Could not find Z3's path. Please set the 'z3Exe' setting or the " +
            "Z3_EXE environment variable, then restart the IDE."
        );
        return [false, msg];
    }
    try {
        await util.spawn("rustup", ["--version"]);
    } catch (err) {
        console.error(err);
        util.log(`Error: ${err}`);
        const msg = (
            "Could not run Rustup. Please visit https://rustup.rs/ and " +
            "install Rustup, then restart the IDE."
        );
        return [false, msg];
    }
    try {
        const javaPath = path.join(config.javaHome(), "bin", "java");
        await util.spawn(javaPath, ["-version"]);
    } catch (err) {
        console.error(err);
        util.log(`Error: ${err}`);
        const msg = (
            "Could not run Java. Please install the 64bit version, then " +
            "restart the IDE."
        );
        return [false, msg];
    }
    try {
        await util.spawn(config.z3Exe(), ["--version"]);
    } catch (err) {
        console.error(err);
        util.log(`Error: ${err}`);
        const msg = (
            "Could not run Z3. Please check that the 'z3Exe' setting or the " +
            "Z3_EXE environment variable point to a valid program, then " +
            "restart the IDE."
        );
        return [false, msg];
    }
    try {
        const prustiRustcPath = path.join(config.prustiHome(), "prusti-rustc");
        await util.spawn(prustiRustcPath, ["--version"]);
    } catch (err) {
        console.error(err);
        util.log(`Error: ${err}`);
        const msg = (
            "Could not run Prusti. Please check that the 'prustiHome' " +
            "setting points to the correct folder, then restart the IDE."
        );
        return [false, msg];
    }
    return [true, ""];
}
