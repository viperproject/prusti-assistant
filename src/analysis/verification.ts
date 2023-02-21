import * as util from "./../util";
import * as config from "./../config"
import * as vscode from "vscode";
import * as path from "path"
import * as dependencies from "../dependencies";
import * as vvt from "vs-verification-toolbox";
import { VerificationDiagnostics } from "./diagnostics";
import { QuantifierInstantiationsProvider, QuantifierChosenTriggersProvider} from "./quantifiers";
import { SelectiveVerificationProvider} from "./selective_verification";

export interface PrustiLineConsumer extends vscode.Disposable {
    try_process_stderr: (line: string, isCrate: boolean, programPath: string) => boolean
}

export enum VerificationTarget {
    StandaloneFile = "file",
    Crate = "crate"
}

enum VerificationStatus {
    Crash,
    Verified,
    Errors,
    SkippedVerification,
    Killed,
}

/**
 * Removes rust's metadata in the specified project folder. This is a work
 * around for `cargo check` not reissuing warning information for libs.
 *
 * @param rootPath The root path of a rust project.
 */
async function removeDiagnosticMetadata(rootPath: string) {
    const pattern = new vscode.RelativePattern(path.join(rootPath, "target", "debug"), "*.rmeta");
    const files = await vscode.workspace.findFiles(pattern);
    const promises = files.map(file => {
        return (new vvt.Location(file.fsPath)).remove()
    });
    await Promise.all(promises)
}


export class VerificationManager {
    private procDestructors: Set<util.KillFunction> = new Set();
    private verificationStatus: vscode.StatusBarItem;
    private killAllButton: vscode.StatusBarItem;
    private runCount = 0;
    // we also keep this extra reference, because we need it
    private verificationDiagnostics: VerificationDiagnostics;
    // order matters: first one to successfully consume a Message gets it
    private parts: PrustiLineConsumer[] = [];

    public constructor(verificationStatus: vscode.StatusBarItem, killAllButton: vscode.StatusBarItem) {
        this.verificationStatus = verificationStatus;
        this.killAllButton = killAllButton;

        const qip = new QuantifierInstantiationsProvider();
        this.parts.push(qip);

        const qctp = new QuantifierChosenTriggersProvider();
        this.parts.push(qctp);

        const svp = new SelectiveVerificationProvider();
        this.parts.push(svp);

        this.verificationDiagnostics = new VerificationDiagnostics();
        this.parts.push(this.verificationDiagnostics);

    }

    public dispose(): void {
        util.log("Dispose VerificationManager");
        this.killAll();
        for (var part of this.parts) {
            part.dispose();
        }
    }

    public inProgress(): number {
        return this.procDestructors.size
    }

    public killAll(): void {
        util.log(`Killing ${this.procDestructors.size} processes.`);
        this.procDestructors.forEach((kill) => kill());
    }

    private build_stderr_closure(isCrate: boolean, programPath: string) {
        let buffer = "";
        const on_output = (data: string) => {
            buffer = buffer.concat(data);
            const ind = buffer.lastIndexOf("\n");
            const parsable = buffer.substring(0, ind);
            buffer = buffer.substring(ind+1);
            for (const line of parsable.split("\n")) {
                for (const part of this.parts) {
                    if (part.try_process_stderr(line, isCrate, programPath)) {
                        break;
                    }
                }
            }
        }
        return on_output;
    }

    private build_stdout_closure(isCrate: boolean, programPath: string) {
        let buffer = "";
        const on_output = (data: string) => {
            buffer = buffer.concat(data);
            const ind = buffer.lastIndexOf("\n");
            const parsable = buffer.substring(0, ind);
            buffer = buffer.substring(ind+1);
            for (const line of parsable.split("\n")) {
                this.verificationDiagnostics.process_stdout(line, isCrate, programPath);
            }
        }
        return on_output;
    }

    private async run_and_process_output(
        prusti: dependencies.PrustiLocation,
        programPath: string,
        serverAddress: string,
        skipVerify: boolean,
        selectiveVerify: string | undefined,
        isCrate: boolean,
    ): Promise<[VerificationStatus, util.Duration]> {
        let prustiArgs: string[] = [];
        if (isCrate) {
            // FIXME: Workaround for warning generation for libs.
            if (!skipVerify) {
                await removeDiagnosticMetadata(programPath);
            }
            // cargo
            prustiArgs = ["--message-format=json"].concat(
                config.extraCargoPrustiArgs()
            );
        } else {
            // rustc
            prustiArgs = [
                "--crate-type=lib",
                "--error-format=json",
                programPath
            ].concat(
                config.extraPrustiRustcArgs()
            );
        }
        util.log("passed args:" + prustiArgs.toString());
        const prustiEnv = {
            ...process.env,  // Needed to run Rustup
            ...{
                PRUSTI_SERVER_ADDRESS: serverAddress,
                PRUSTI_SHOW_IDE_INFO: "true",
                PRUSTI_SKIP_VERIFICATION: skipVerify ? "true" : "false",
                //TODO: @cedihegi: the environment was set up differently for rustc and cargo. I took this config. Is this correct?
                PRUSTI_SELECTIVE_VERIFY: skipVerify ? undefined : selectiveVerify,
                PRUSTI_QUERY_METHOD_SIGNATURE: skipVerify ? selectiveVerify : undefined,
                PRUSTI_QUIET: "true",
                JAVA_HOME: (await config.javaHome())!.path,
            },
            ...config.extraPrustiEnv(),
        };
        const cwd = isCrate ? programPath : path.dirname(programPath);
        const on_stderr = this.build_stderr_closure(isCrate, programPath);
        const on_stdout = this.build_stdout_closure(isCrate, programPath);
        const output = await util.spawn(
            isCrate ? prusti.cargoPrusti : prusti.prustiRustc,
            prustiArgs,
            {
                options: {
                    cwd: cwd,
                    env: prustiEnv,
                },
                onStdout: on_stdout,
                onStderr: on_stderr,
            },
            this.procDestructors,
        );

        let status = VerificationStatus.Crash;

        if (output.code === 0) {
            if (skipVerify) {
                status = VerificationStatus.SkippedVerification;
            } else {
                status = VerificationStatus.Verified;
            }
        }

        if (output.code === 1) {
            status = VerificationStatus.Errors;
        }
        if (output.code === 101) {
            status = VerificationStatus.Errors;
        }
        if (/error: internal compiler error/.exec(output.stderr) !== null) {
            status = VerificationStatus.Crash;
        }
        if (/^thread '.*' panicked at/.exec(output.stderr) !== null) {
            status = VerificationStatus.Crash;
        }
        // we were (probably?) killed by killAll -> not necessary to show that Prusti encountered an
        // unexpected error
        if (output.code === null && output.signal === "SIGKILL") {
            status = VerificationStatus.Killed;
        }

        return [status, output.duration];
    }

    public async verify(prusti: dependencies.PrustiLocation, serverAddress: string, targetPath: string, target: VerificationTarget, skip_verification: boolean, selective_verify: string | undefined): Promise<void> {
        // Prepare verification
        this.runCount += 1;
        const currentRun = this.runCount;
        util.log(`Preparing verification run #${currentRun}.`);
        this.killAll();
        this.killAllButton.show();
        util.log(serverAddress);


        this.verificationDiagnostics.reset();

        // Run verification
        const escapedFileName = path.basename(targetPath).replace("$", "\\$");
        const prevStatus = this.verificationStatus.text;

        if (!skip_verification) {
            this.verificationStatus.text = `$(sync~spin) Verifying ${target} '${escapedFileName}'...`;
        } else {
            this.verificationStatus.text = `$(sync~spin) Analyzing ${target} '${escapedFileName}'...`;
        }

        let durationSecMsg: string | null = null;
        const crashErrorMsg = "Prusti encountered an unexpected error. " +
            "We would appreciate a [bug report](https://github.com/viperproject/prusti-dev/issues/new). " +
            "See the log (View -> Output -> Prusti Assistant) for more details.";
        let crashed = false;
        try {
            util.log("starting verification");
            let [status, duration] = await this.run_and_process_output(
                    prusti,
                    targetPath,
                    serverAddress,
                    skip_verification,
                    selective_verify,
                    target === VerificationTarget.Crate
            );

            durationSecMsg = (duration[0] + duration[1] / 1e9).toFixed(1);
            if (status === VerificationStatus.Crash) {
                crashed = true;
                util.log("Prusti encountered an unexpected error.");
                util.userError(crashErrorMsg);
            }
            if (status === VerificationStatus.Errors && !this.verificationDiagnostics.hasErrors()) {
                crashed = true;
                util.log("The verification failed, but there are no errors to report.");
                // util.userError(crashErrorMsg);
                // TODO: put this back in once we dont have to create a fake error
                // to avoid caching of the result for no-verify flag..
            }
        } catch (err) {
            util.log(`Error while running Prusti: ${err}`);
            crashed = true;
            util.userError(crashErrorMsg);
        }

        if (currentRun != this.runCount) {
            // TODO: take this into consideration everywhere
            util.log(`Discarding the result of the verification run #${currentRun}, because the latest is #${this.runCount}.`);
        } else {
            this.killAllButton.hide();
            const prustiErrors = this.verificationDiagnostics.countPrustiErrors();
            const counts = this.verificationDiagnostics.countsBySeverity();
            if (crashed) {
                this.verificationStatus.text = `$(error) Verification of ${target} '${escapedFileName}' failed with an unexpected error`;
                this.verificationStatus.command = "workbench.action.output.toggleOutput";
            } else if (this.verificationDiagnostics.hasErrors() && prustiErrors > 0) {
                const noun = prustiErrors === 1 ? "error" : "errors";
                this.verificationStatus.text = `$(error) Verification of ${target} '${escapedFileName}' failed with ${prustiErrors} ${noun} (${durationSecMsg} s)`;
                this.verificationStatus.command = "workbench.action.problems.focus";
            } else if (this.verificationDiagnostics.hasErrors() && prustiErrors == 0) {
                const errors = counts.get(vscode.DiagnosticSeverity.Error);
                const noun = errors === 1 ? "error" : "errors";
                this.verificationStatus.text = `$(error) Compilation of ${target} '${escapedFileName}' failed with ${errors} ${noun} (${durationSecMsg} s)`;
                this.verificationStatus.command = "workbench.action.problems.focus";
            } else if (this.verificationDiagnostics.hasWarnings()) {
                const warnings = counts.get(vscode.DiagnosticSeverity.Warning);
                const noun = warnings === 1 ? "warning" : "warnings";
                this.verificationStatus.text = `$(warning) Verification of ${target} '${escapedFileName}' succeeded with ${warnings} ${noun} (${durationSecMsg} s)`;
                this.verificationStatus.command = "workbench.action.problems.focus";
            } else {
                this.verificationStatus.text = `$(check) Verification of ${target} '${escapedFileName}' succeeded (${durationSecMsg} s)`;
                this.verificationStatus.command = undefined;
            }
            if (skip_verification) {
                this.verificationStatus.text = prevStatus;
            }
        }
    }
}

