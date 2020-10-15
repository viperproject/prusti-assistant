import { Location } from "vs-verification-toolbox";
import * as findJavaHomeLib from 'find-java-home';
import * as util from './util';

async function parseJavaHome(): Promise<string | null> {
    const output = await util.spawn(
        "java",
        ["-XshowSettings:properties", "-version"]
    ).output;
    const java_home_line = output.stderr.split("\n")
        .find((line) => line.indexOf("java.home") != -1);
    if (java_home_line === undefined) {
        return null;
    }
    return java_home_line.split("=")[1].trim()
}

export async function findJavaHome(): Promise<string | null> {
    try {
        const options: findJavaHomeLib.IOptions = {
            allowJre: false,
            registry: "x64",
        };
        console.log("Searching for Java home...");
        let javaHome: string | null = await new Promise(resolve => {
            findJavaHomeLib(options, (err: unknown, home: string) => {
                if (err !== null) {
                    console.error(err);
                    resolve(null);
                } else {
                    console.log("Using Java home", home);
                    resolve(home);
                }
            });
        });
        if (javaHome === null) {
            // Last resort
            javaHome = await parseJavaHome();
        }
        return javaHome;
    } catch (err) {
        console.error(err);
        throw err
    }
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
