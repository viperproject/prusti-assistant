import { Location } from 'vs-verification-toolbox';
import * as fs from 'fs-extra';

export class PrustiLocation {
    constructor(
        private readonly location: Location
    ) {
        // Set execution flags (ignored on Windows)
        fs.chmodSync(this.prustiDriver, 0o775);
        fs.chmodSync(this.prustiRustc, 0o775);
        fs.chmodSync(this.cargoPrusti, 0o775);
        fs.chmodSync(this.z3, 0o775);
    }

    public async rustToolchainVersion(): Promise<string> {
        const buffer = await fs.readFile(this.location.path("rust-toolchain"));
        return buffer.toString('utf8').trim();
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

    public get prustiServer(): string {
        return this.location.executable("prusti-server");
    }

    public get z3(): string {
        return this.location.child("z3").executable("z3");
    }

    public get boogie(): string {
        return this.location.child("boogie").executable("boogie");
    }

    public get viperHome(): string {
        return this.location.path("viper");
    }
}
