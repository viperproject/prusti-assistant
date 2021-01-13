import { Location } from "vs-verification-toolbox";
import * as locatejavaHome from 'locate-java-home';
import * as util from './util';

export async function findJavaHome(): Promise<string | null> {
    console.log("Searching for Java home...");
    let javaHome: string | null = null;
    try {
        javaHome = await new Promise((resolve, reject) => {
            const options = {
                version: ">=11"
            };
            locatejavaHome.default(options, (err, javaHomes) => {
                if (err) {
                    console.error(err);
                    reject(err);
                } else {
                    if (!Array.isArray(javaHomes) || javaHomes.length === 0) {
                        util.log(
                            `Could not find a Java home with version ${options.version}. ` +
                            "See the requirements in the description of the extension."
                        );
                        resolve(null);
                    } else {
                        const firstJavaHome = javaHomes[0];
                        console.log(`Using Java home ${JSON.stringify(firstJavaHome, null, 2)}`);
                        resolve(firstJavaHome.path);
                    }
                }
            });
        });
    } catch (err) {
        util.log(`Error while searching for Java home: ${err}`);
    }
    return javaHome;
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
