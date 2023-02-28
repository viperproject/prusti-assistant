import * as vscode from "vscode";
import * as path from "path"
import * as vvt from "vs-verification-toolbox";
import * as util from "./util";
import * as config from "./config"
import * as dependencies from "./dependencies";
import * as semver from "semver";
import { VerificationDiagnostics } from "./analysis/diagnostics";
import { PrustiMessageConsumer, getRustcMessage, getCargoMessage } from "./analysis/message";
import { QuantifierInstantiationsProvider, QuantifierChosenTriggersProvider } from "./analysis/quantifiers";
import { InfoCollection} from "./analysis/infoCollection";

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

    private verificationDiagnostics: VerificationDiagnostics;
    private qip: QuantifierInstantiationsProvider;
    private qctp: QuantifierChosenTriggersProvider;
    private infoCollection: InfoCollection;

    public constructor(
        verificationStatus: vscode.StatusBarItem,
        killAllButton: vscode.StatusBarItem,
    ) {
        this.verificationStatus = verificationStatus;
        this.killAllButton = killAllButton;

        this.qip = new QuantifierInstantiationsProvider();
        this.qctp = new QuantifierChosenTriggersProvider();
        this.infoCollection = new InfoCollection();
        this.verificationDiagnostics = new VerificationDiagnostics();
    }

    public dispose(): void {
        util.log("Dispose VerificationManager");
        this.killAll();
        this.qip.dispose();
        this.qctp.dispose();
        this.infoCollection.dispose();
        this.verificationDiagnostics.dispose();
    }

    public inProgress(): number {
        return this.procDestructors.size
    }

    public killAll(): void {
        util.log(`Killing ${this.procDestructors.size} processes.`);
        this.procDestructors.forEach((kill) => kill());
    }

    private findConsumer(token: string): PrustiMessageConsumer {
        switch (token) {
            case "ideVerificationResult":
            case "compilerInfo":
            case "encodingInfo": {
                return this.infoCollection;
            }
            case "quantifierInstantiationsMessage": {
                return this.qip;
            }
            case "quantifierChosenTriggersMessage": {
                return this.qctp;
            }
            default: {
                return this.verificationDiagnostics;
            }
        }
    }

    private buildOutputClosure(isCrate: boolean, programPath: string, currentRun: number) {
        let buffer = "";
        const onOutput = (data: string) => {
            if (currentRun != this.runCount) {
                return;
            }
            buffer = buffer.concat(data);
            const ind = buffer.lastIndexOf("\n");
            const parsable = buffer.substring(0, ind);
            buffer = buffer.substring(ind+1);
            for (const line of parsable.split("\n")) {
                if (isCrate) {
                    const cargoMsg = getCargoMessage(line);
                    if (cargoMsg === undefined) {
                        continue;
                    }
                    const msg = cargoMsg.message;
                    const ind = msg.message.indexOf("{");
                    const token = msg.message.substring(0, ind);
                    const part = this.findConsumer(token);
                    part.processCargoMessage(cargoMsg, isCrate, programPath)
                } else {
                    const msg = getRustcMessage(line);
                    if (msg === undefined) {
                        continue;
                    }
                    const ind = msg.message.indexOf("{");
                    const token = msg.message.substring(0, ind);
                    const part = this.findConsumer(token);
                    part.processMessage(msg, isCrate, programPath)
                }
            }
        }
        return onOutput;
    }

    /** The core function invoking prusti. Not only for verification, but
    * also to collect other information (without verifying anything).
    *
    * @param skipVerify: whether or not verification should be skipped
    * @param defPathArg: there are 2 cases when we pass a defpath to prusti. One
    * is for selective verification, the other is when we request a template for
    * an external specification.
    */
    private async runAndProcessOutput(
        prusti: dependencies.PrustiLocation,
        programPath: string,
        serverAddress: string,
        skipVerify: boolean,
        defPathArg: {
            selectiveVerification?: string,
            externalSpecRequest?: string,
        },
        isCrate: boolean,
        currentRun: number,
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

        // some environment variables can only be passed if we have at least
        // prusti version 0.3
        let versionDependentArgs = semver.lt(dependencies.prustiSemanticVersion, "0.3.0") ? {} : {
            PRUSTI_SHOW_IDE_INFO: "true",
            PRUSTI_SKIP_VERIFICATION: skipVerify ? "true" : "false",
            PRUSTI_SELECTIVE_VERIFY: defPathArg.selectiveVerification,
            PRUSTI_QUERY_METHOD_SIGNATURE: defPathArg.externalSpecRequest,
            PRUSTI_REPORT_VIPER_MESSAGES: config.reportViperMessages() ? "true" : "false",
        };

        util.log("passed args:" + prustiArgs.toString());
        const prustiEnv = {
            ...process.env,  // Needed to run Rustup
            ...versionDependentArgs,
            ...{
                PRUSTI_SERVER_ADDRESS: serverAddress,
                PRUSTI_QUIET: "true",
                JAVA_HOME: (await config.javaHome())!.path,
            },
            ...config.extraPrustiEnv(),
        };
        const cwd = isCrate ? programPath : path.dirname(programPath);
        const onOutput= this.buildOutputClosure(isCrate, programPath, currentRun);
        const output = await util.spawn(
            isCrate ? prusti.cargoPrusti : prusti.prustiRustc,
            prustiArgs,
            {
                options: {
                    cwd: cwd,
                    env: prustiEnv,
                },
                onStdout: isCrate ? onOutput : undefined,
                onStderr: isCrate ? undefined : onOutput,
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

    public async verify(
        prusti: dependencies.PrustiLocation,
        serverAddress: string,
        targetPath: string,
        target: VerificationTarget,
        skipVerification: boolean,
        defPathArg: {
            selectiveVerification?: string,
            externalSpecRequest?: string,
        }
    ): Promise<void> {
        // Prepare verification
        this.runCount += 1;
        const currentRun = this.runCount;
        util.log(`Preparing verification run #${currentRun}.`);
        this.killAll();
        this.killAllButton.show();

        this.clearPreviousVerification(targetPath, target == VerificationTarget.Crate, skipVerification, defPathArg);

        // Run verification
        const escapedFileName = path.basename(targetPath).replace("$", "\\$");
        const prevStatus = this.verificationStatus.text;

        if (!skipVerification) {
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
            util.log("Starting verification");
            let [status, duration] = await this.runAndProcessOutput(
                    prusti,
                    targetPath,
                    serverAddress,
                    skipVerification,
                    defPathArg,
                    target === VerificationTarget.Crate,
                    currentRun
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
            if (skipVerification) {
                this.verificationStatus.text = prevStatus;
            }
        }
    }

    /**
    * Some data-structures need to be cleaned up between verifications of
    * the same program / crate.
    */
    public clearPreviousVerification(
        programPath: string,
        _isCrate: boolean,
        skipVerification: boolean,
        _defPathArg: {
            selectiveVerification?: string,
            externalSpecRequest?: string,
        }
    ) {
        this.verificationDiagnostics.reset();
        this.infoCollection.clearPreviousRun(programPath);
        if (!skipVerification) {
          this.qip.reset();
          this.qctp.reset();
        }
    }

    public wasVerifiedBefore(programPath: string): boolean {
        return this.infoCollection.wasVerifiedBefore(programPath);
    }

    // public setVersion(version: string) {
    //     if (!semver.valid(version)) {
    //         // just to make sure this would not go unnoticed
    //         util.userInfo("There was a problem figuring out your version of Prusti");
    //         this.version = "0.0";
    //     } else {
    //         this.version = version;
    //     }
    // }
}

