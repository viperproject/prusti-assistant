import * as util from "./util";
import * as config from "./config";
import * as dependencies from "./dependencies";

export interface CrateMetadata {
    target_directory: string;
    workspace_root?: string;
}

export enum CrateMetadataStatus {
    Error,
    Ok
}

/**
 * Queries for the metadata of a Rust crate using cargo-prusti.
 *
 * @param prusti The location of Prusti files.
 * @param cratePath The path of a Rust crate.
 * @param destructors Where to store the destructors of the spawned processes.
 * @returns A tuple containing the metadata, the exist status, and the duration of the query.
 */
export async function queryCrateMetadata(
    prusti: dependencies.PrustiLocation,
    cratePath: string,
    destructors: Set<util.KillFunction>,
): Promise<[CrateMetadata, CrateMetadataStatus, util.Duration]> {
    const cargoPrustiArgs = ["--no-deps", "--offline", "--format-version=1"].concat(
        config.extraCargoPrustiArgs()
    );
    const cargoPrustiEnv = {
        ...process.env,  // Needed to run Rustup
        ...{
            PRUSTI_CARGO_COMMAND: "metadata",
            PRUSTI_QUIET: "true",
        },
        ...config.extraPrustiEnv(),
    };
    const output = await util.spawn(
        prusti.cargoPrusti,
        cargoPrustiArgs,
        {
            options: {
                cwd: cratePath,
                env: cargoPrustiEnv,
            }
        },
        destructors,
    );
    let status = CrateMetadataStatus.Error;
    if (output.code === 0) {
        status = CrateMetadataStatus.Ok;
    }
    if (/error: internal compiler error/.exec(output.stderr) !== null) {
        status = CrateMetadataStatus.Error;
    }
    if (/^thread '.*' panicked at/.exec(output.stderr) !== null) {
        status = CrateMetadataStatus.Error;
    }
    const metadata = JSON.parse(output.stdout) as CrateMetadata;
    return [metadata, status, output.duration];
}
