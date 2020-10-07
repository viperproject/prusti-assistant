import { Location } from "vs-verification-toolbox";
import * as findJavaHomeLib from 'find-java-home';

export async function findJavaHome(): Promise<string | null> {
    return new Promise((resolve, reject) => {
        try {
            const options: findJavaHomeLib.IOptions = {
                allowJre: false,
                registry: "x64",
            };
            console.log("Searching for Java home...");
            findJavaHomeLib(options, (err, home) => {
                if (err !== null) {
                    console.error(err);
                    resolve(null);
                } else {
                    console.log("Using Java home", home);
                    resolve(home);
                }
            });
        }
        catch (err) {
            console.error(err);
            resolve(null);
        }
    });
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
