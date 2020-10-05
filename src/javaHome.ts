import * as locate_java_home from 'locate-java-home';
import { Location } from 'vs-verification-toolbox';

export async function findJavaHome(): Promise<string | null> {
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
