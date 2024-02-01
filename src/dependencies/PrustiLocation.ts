import { Location } from "vs-verification-toolbox";
import * as fs from "fs-extra";

export class PrustiLocation {
    constructor(
        private readonly prustiLocation: Location,
        private readonly viperToolsLocation: Location,
        public readonly rustToolchainFile: Location
    ) {
        // Set execution flags (ignored on Windows)
        fs.chmodSync(this.prustiDriver, 0o775);
        fs.chmodSync(this.prustiRustc, 0o775);
        fs.chmodSync(this.cargoPrusti, 0o775);
        fs.chmodSync(this.z3, 0o775);
        fs.chmodSync(this.boogie, 0o775);
        fs.chmodSync(this.prustiServerDriver, 0o775);
        fs.chmodSync(this.prustiServer, 0o775);
    }

    public get prustiDriver(): string {
        return this.prustiLocation.executable("prusti-driver");
    }

    public get prustiRustc(): string {
        return this.prustiLocation.executable("prusti-rustc");
    }

    public get cargoPrusti(): string {
        return this.prustiLocation.executable("cargo-prusti");
    }

    public get prustiServerDriver(): string {
        return this.prustiLocation.executable("prusti-server-driver");
    }

    public get prustiServer(): string {
        return this.prustiLocation.executable("prusti-server");
    }

    public get z3(): string {
        return this.viperToolsLocation.child("z3").child("bin")
            .executable("z3");
    }

    public get boogie(): string {
        return this.viperToolsLocation.child("boogie")
            .child("Binaries").executable("Boogie");
    }
}
