import { Location } from "vs-verification-toolbox";
import * as fs from "fs-extra";
import * as config from "../config";

export class PrustiLocation {
    constructor(
        private readonly location: Location
    ) {
        // Set execution flags (ignored on Windows)
        fs.chmodSync(this.prustiDriver, 0o775);
        fs.chmodSync(this.prustiRustc, 0o775);
        fs.chmodSync(this.cargoPrusti, 0o775);
        fs.chmodSync(this.z3, 0o775);
        fs.chmodSync(this.prustiServerDriver, 0o775);
        fs.chmodSync(this.prustiServer, 0o775);
    }

    public async rustToolchainVersion(): Promise<string> {
        const buffer = await fs.readFile(this.location.path("rust-toolchain"));
        const content = buffer.toString("utf8").trim();
        if (content.startsWith("[toolchain]")) {
            const channel_line = content.split("\n")
                .find((line: string) => line.startsWith("channel"));
            if (channel_line === undefined) {
                throw new Error("failed to parse rust-toolchain file");
            }
            const value = channel_line.split("=")[1];
            return value.replace(/"/g, '').trim();
        } else {
            return content;
        }
    }

    public async rustToolchainComponents(): Promise<string[]> {
        const buffer = await fs.readFile(this.location.path("rust-toolchain"));
        const content = buffer.toString("utf8").trim();
        if (content.startsWith("[toolchain]")) {
            const components_line = content.split("\n")
                .find((line: string) => line.startsWith("components"));
            if (components_line === undefined) {
                return [];
            }
            const value = components_line.split("=")[1];
            const values = value.replace(/[\[\]]/g, '').trim().split(",");
            return values.map((x: string) => x.replace(/"/g, '').trim());
        } else {
            return config.isDevBuildChannel()
                ? ["rustc-dev", "llvm-tools-preview"]
                : [];
        }
    }

    public get prustiDriver(): string {
        return this.location.executable("prusti-driver");
    }

    public get prustiRustc(): string {
        return this.location.executable("prusti-rustc");
    }

    public get cargoPrusti(): string {
        return this.location.executable("cargo-prusti");
    }

    public get prustiServerDriver(): string {
        return this.location.executable("prusti-server-driver");
    }

    public get prustiServer(): string {
        return this.location.executable("prusti-server");
    }

    public get z3(): string {
        return this.location.child("viper_tools").child("z3").child("bin")
            .executable("z3");
    }

    public get boogie(): string {
        return this.location.child("viper_tools").child("boogie")
            .child("Binaries").executable("Boogie");
    }

    public get viperHome(): string {
        return this.location.child("viper_tools").path("backends");
    }
}
