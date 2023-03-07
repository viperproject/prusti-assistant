import * as vscode from "vscode";
import * as path from "path"
import * as vvt from "vs-verification-toolbox";
import * as util from "./util";
import * as config from "./config"
import * as dependencies from "./dependencies";
import * as semver from "semver";
import { VerificationDiagnostics } from "./types/diagnostics";
import { PrustiMessageConsumer, getRustcMessage, getCargoMessage } from "./types/message";
import { QuantifierInstantiationsProvider, QuantifierChosenTriggersProvider } from "./types/quantifiers";
import { InfoCollection} from "./infoCollection";

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

export class VerificationArgs {
    constructor(
        public prusti: dependencies.PrustiLocation,
        public serverAddress: string,
        public targetPath: string,
        public target: VerificationTarget,
        public skipVerify: boolean,
        public defPathArg: {
             selectiveVerification?: string,
             externalSpecRequest?: string,
        },
        // whether this request was sent because of an onOpen event
        public isOnOpen: boolean,
        public currentRun: number,
    ) {}
}

/**
 * Removes rust's metadata in the specified project folder. This is a work
 * around for `cargo check` not reissuing warning information for libs.
 *
 * @param targetPath The root path of a rust project.
 */
async function removeDiagnosticMetadata(targetPath: string) {
    const pattern = new vscode.RelativePattern(path.join(targetPath, "target", "debug"), "*.rmeta");
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

    private verificationDiagnostics: VerificationDiagnostics;
    private qip: QuantifierInstantiationsProvider;
    private qctp: QuantifierChosenTriggersProvider;
    private infoCollection: InfoCollection;
    // the global runCount
    private runCount = 0;
    // whether a file has been opened before
    public opened: Set<string>;

    public constructor(
        verificationStatus: vscode.StatusBarItem,
        killAllButton: vscode.StatusBarItem,
    ) {
        this.verificationStatus = verificationStatus;
        this.killAllButton = killAllButton;

        this.qip = new QuantifierInstantiationsProvider();
        this.qctp = new QuantifierChosenTriggersProvider();
        this.infoCollection = new InfoCollection(this);
        this.verificationDiagnostics = new VerificationDiagnostics();
        this.opened = new Set();
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

    private buildOutputClosure(vArgs: VerificationArgs) {
        let buffer = "";
        const isCrate = vArgs.target === VerificationTarget.Crate;
        const onOutput = (data: string) => {
            if (vArgs.currentRun !== this.runCount) {
                // there could be race conditions where messages are consumed after
                // this check. If this becomes a problem, a more sophisticated check is needed
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
                    part.processCargoMessage(cargoMsg, vArgs);
                } else {
                    const msg = getRustcMessage(line);
                    if (msg === undefined) {
                        continue;
                    }
                    const ind = msg.message.indexOf("{");
                    const token = msg.message.substring(0, ind);
                    const part = this.findConsumer(token);
                    part.processMessage(msg, vArgs);
                }
            }
        }
        return onOutput;
    }

    /** The core function invoking prusti. Not only for verification, but
    * also to collect other information (without verifying anything).
    */
    private async runAndProcessOutput(vArgs: VerificationArgs): Promise<[VerificationStatus, util.Duration]> {
        let prustiArgs: string[] = [];
        const isCrate = vArgs.target === VerificationTarget.Crate;
        if (isCrate) {
            // FIXME: Workaround for warning generation for libs.
            if (!vArgs.skipVerify) {
                await removeDiagnosticMetadata(vArgs.targetPath);
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
                vArgs.targetPath
            ].concat(
                config.extraPrustiRustcArgs()
            );
        }

        // some environment variables can only be passed if we have at least
        // prusti version 0.3
        const outdatedPrustiVersion = semver.lt(dependencies.prustiSemanticVersion, "0.3.0");
        const versionDependentArgs =  outdatedPrustiVersion ? {} : {
            PRUSTI_SHOW_IDE_INFO: "true",
            PRUSTI_SKIP_VERIFICATION: vArgs.skipVerify ? "true" : "false",
            PRUSTI_VERIFY_ONLY_DEFPATH: vArgs.defPathArg.selectiveVerification,
            PRUSTI_QUERY_METHOD_SIGNATURE: vArgs.defPathArg.externalSpecRequest,
            PRUSTI_REPORT_VIPER_MESSAGES: config.reportViperMessages() ? "true" : "false",
            PRUSTI_SMT_QI_PROFILE: "true",
            PRUSTI_SMT_QI_PROFILE_FREQ: "100",
        };

        // with the newer version we can run prusti just to get information
        // without actually running a verification. With the older versions
        // this would cause an actual verification so we stop this here.
        if (outdatedPrustiVersion && vArgs.skipVerify) {
            return [VerificationStatus.SkippedVerification, [0,0]];
        }
        util.log("Prusti client args: " + prustiArgs.toString());
        const prustiEnv = {
            ...process.env,  // Needed to run Rustup
            ...versionDependentArgs,
            ...{
                PRUSTI_SERVER_ADDRESS: vArgs.serverAddress,
                PRUSTI_QUIET: "true",
                JAVA_HOME: (await config.javaHome())!.path,
            },
            ...config.extraPrustiEnv(),
        };
        util.log("Prusti client environment: " + JSON.stringify({...versionDependentArgs, ...config.extraPrustiEnv}, null, 4));
        const cwd = isCrate ? vArgs.targetPath : path.dirname(vArgs.targetPath);
        const onOutput= this.buildOutputClosure(vArgs);
        const output = await util.spawn(
            isCrate ? vArgs.prusti.cargoPrusti : vArgs.prusti.prustiRustc,
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
            if (vArgs.skipVerify) {
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

    public async verify(vArgs: VerificationArgs): Promise<void> {
        // prepare verification:
        if (vArgs.isOnOpen) {
            // onOpen requests are only allowed when they are the first
            // verification that is executed on this file / crate.
            // This was problematic because sometimes (tests mainly) the
            // verification that was invoked manually happened first, followed
            // by the OnOpen verification (which would clear the previous results)
            if (this.opened.has(vArgs.targetPath)) {
                // this path was verified before
                return
            }
        }
        this.opened.add(vArgs.targetPath);
        this.runCount += 1;
        vArgs.currentRun = this.runCount;

        util.log(`Preparing verification run #${vArgs.currentRun}. isOnOpen: ${vArgs.isOnOpen}`);
        this.killAll(); // kill all current subprocesses
        this.killAllButton.show();

        this.prepareVerification(vArgs);

        // Run verification
        const escapedFileName = path.basename(vArgs.targetPath).replace("$", "\\$");
        const prevStatus = this.verificationStatus.text;

        if (!vArgs.skipVerify) {
            this.verificationStatus.text = `$(sync~spin) Verifying ${vArgs.target} '${escapedFileName}'...`;
        } else {
            this.verificationStatus.text = `$(sync~spin) Analyzing ${vArgs.target} '${escapedFileName}'...`;
        }

        let durationSecMsg: string | null = null;
        const crashErrorMsg = "Prusti encountered an unexpected error. " +
            "We would appreciate a [bug report](https://github.com/viperproject/prusti-dev/issues/new). " +
            "See the log (View -> Output -> Prusti Assistant) for more details.";
        let crashed = false;
        try {
            util.log("Starting verification");
            const [status, duration] = await this.runAndProcessOutput(vArgs);

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

        // here the "global" runCount is important, not per file, because
        // the verificationStatus is displayed independant of the open editor
        if (vArgs.currentRun != this.runCount) {
            util.log(`Discarding the result of the verification run #${vArgs.currentRun}, because the latest is #${this.runCount}.`);
        } else {
            this.killAllButton.hide();
            this.verificationDiagnostics.renderIn();
            const prustiErrors = this.verificationDiagnostics.countPrustiErrors();
            const counts = this.verificationDiagnostics.countsBySeverity();
            if (crashed) {
                this.verificationStatus.text = `$(error) Verification of ${vArgs.target} '${escapedFileName}' failed with an unexpected error`;
                this.verificationStatus.command = "workbench.action.output.toggleOutput";
            } else if (this.verificationDiagnostics.hasErrors() && prustiErrors > 0) {
                const noun = prustiErrors === 1 ? "error" : "errors";
                this.verificationStatus.text = `$(error) Verification of ${vArgs.target} '${escapedFileName}' failed with ${prustiErrors} ${noun} (${durationSecMsg} s)`;
                this.verificationStatus.command = "workbench.action.problems.focus";
            } else if (this.verificationDiagnostics.hasErrors() && prustiErrors == 0) {
                const errors = counts.get(vscode.DiagnosticSeverity.Error);
                const noun = errors === 1 ? "error" : "errors";
                this.verificationStatus.text = `$(error) Compilation of ${vArgs.target} '${escapedFileName}' failed with ${errors} ${noun} (${durationSecMsg} s)`;
                this.verificationStatus.command = "workbench.action.problems.focus";
            } else if (this.verificationDiagnostics.hasWarnings()) {
                const warnings = counts.get(vscode.DiagnosticSeverity.Warning);
                const noun = warnings === 1 ? "warning" : "warnings";
                this.verificationStatus.text = `$(warning) Verification of ${vArgs.target} '${escapedFileName}' succeeded with ${warnings} ${noun} (${durationSecMsg} s)`;
                this.verificationStatus.command = "workbench.action.problems.focus";
            } else {
                this.verificationStatus.text = `$(check) Verification of ${vArgs.target} '${escapedFileName}' succeeded (${durationSecMsg} s)`;
                this.verificationStatus.command = undefined;
            }
            if (vArgs.skipVerify) {
                this.verificationStatus.text = prevStatus;
            }
        }
    }

    /**
     * This function is called by the infoCollection after parsing a CompilerInfo
     * so that all files that are affected by the compilation can be reset accordingly.
     */
    public prepareFile(fileName: string) : void {
        this.qip.invalidateDocument(fileName);
        this.qctp.invalidateDocument(fileName);
    }

    /**
    * Some data-structures need to be cleaned up between verifications of
    * the same program / crate.
    * Note that some of this work is also done in the prepareFile method that is called after
    */
    public prepareVerification(vArgs: VerificationArgs): void {
        this.verificationDiagnostics.reset();
        this.infoCollection.clearPreviousRun(vArgs.targetPath);
    }

    public wasVerifiedBefore(programPath: string): boolean {
        return this.infoCollection.wasVerifiedBefore(programPath);
    }
}

