import { Location } from "vs-verification-toolbox";
import * as findJavaHomePkg from 'find-java-home';
import * as util from './util';

type FindJavaHomeCallback = (err: Error | null, home: string) => void;
type FindJavaHomeFunc = (options: { allowJre: boolean }, callback: FindJavaHomeCallback) => void;

export async function findJavaHome(): Promise<string | null> {
    util.log("Searching for Java home...");
    let javaHome: string | null = null;
    try {
        javaHome = await new Promise<string | null>((resolve) => {
            const findJavaHomeFunc = ((findJavaHomePkg as { default?: FindJavaHomeFunc }).default || findJavaHomePkg) as FindJavaHomeFunc;
            findJavaHomeFunc({ allowJre: true }, (err: Error | null, home: string) => {
                if (err) {
                    util.log(`Error: ${err}`);
                    resolve(null);
                } else if (!home) {
                    util.log(
                        "Could not find a Java home. " +
                        "See the requirements in the description of the extension."
                    );
                    resolve(null);
                } else {
                    util.log(`Found Java home at ${home}`);
                    resolve(home);
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
