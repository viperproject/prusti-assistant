import { Location } from "vs-verification-toolbox";
import * as findJavaHomeLib from 'find-java-home';
import * as process from 'process';
import * as util from './util';

async function parseJavaHome(): Promise<string | null> {
    const output = await util.spawn(
        "java",
        ["-XshowSettings:properties", "-version"]
    );
    const java_home_line = output.stderr.split("\n")
        .find((line) => line.indexOf("java.home") != -1);
    if (java_home_line === undefined) {
        return null;
    }
    return java_home_line.split("=")[1].trim()
}

export async function findJavaHome(): Promise<string | null> {
    console.log("Searching for Java home...");
    let javaHome: string | null = null;
    try {
        const options: findJavaHomeLib.IOptions = {
            allowJre: false,
            registry: "x64",
        };
        javaHome = await new Promise(resolve => {
            findJavaHomeLib(options, (err: unknown, home: string) => {
                if (err) {
                    console.error(err);
                    resolve(null);
                } else {
                    console.log("Using Java home", home);
                    resolve(home);
                }
            });
        });
    } catch (err) {
        util.log(`Error while searching for Java home: ${err}`);
    }
    if (javaHome === null) {
        javaHome = process.env.JAVA_HOME || null;
    }
    if (javaHome === null) {
        javaHome = await parseJavaHome();
    }
    return javaHome || null;
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
