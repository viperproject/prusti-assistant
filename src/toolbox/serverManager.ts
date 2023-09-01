import * as childProcess from "child_process";
import * as treeKill from "tree-kill";
import { StateMachine } from "./stateMachine";

/**
 * The state of the process of a server.
 */
enum State {
    /** A process that is running and has not yet been marked as ready. */
    Running = "Running",
    /** A running process that has been marked as ready. */
    Ready = "Ready",
    /** A process that never started, or that has been explicitly stopped. */
    Stopped = "Stopped",
    /** A process that terminated without being explicitly stopped. */
    Crashed = "Crashed",
    /** A process that failed to get killed. */
    Unrecoverable = "Unrecoverable",
}

export interface StartOptions {
    readonly cwd?: string;
    readonly env?: NodeJS.ProcessEnv;
    readonly onStdout?: (data: string) => void;
    readonly onStderr?: (data: string) => void;
}

export class ServerError extends Error {
    constructor(public name: string, m: string) {
        super(m);

        // Set the prototype explicitly.
        Object.setPrototypeOf(this, ServerError.prototype);
    }
}

export class ServerManager {
    private readonly name: string;
    private readonly state: StateMachine<State>;
    private readonly log: (data: string) => void;
    private readonly procExitCallback: (code: unknown) => void;
    private proc?: childProcess.ChildProcessWithoutNullStreams;

    /**
     * Construct a new server manager.
     *
     * @param log: the function to be called to report log messages.
     */
    public constructor(name: string, log?: (data: string) => void) {
        this.name = name;
        this.log = (data) => (log ?? console.log)(`[${this.name}] ${data}`);
        this.state =  new StateMachine(`${name} state`, State.Stopped);
        this.procExitCallback = (code: unknown) => {
            this.log(`Server process unexpected terminated with exit code ${code}`);
            this.proc = undefined;
            this.setState(State.Crashed);
        };
    }

    /**
     * Return whether the current server state is `state`.
     */
    private isState(state: State): boolean {
        const currentState = State[this.state.getState() as keyof typeof State];
        return currentState === state;
    }

    /**
     * Set a new state of the server.
     */
    private setState(newState: State): void {
        this.log(`Mark server as "${newState}".`);

        // Check an internal invariant.
        switch (newState) {
            case State.Ready:
            case State.Running:
            case State.Unrecoverable:
                if (this.proc === undefined) {
                    throw new ServerError(
                        this.name,
                        `State will become ${newState}, but proc is undefined.`
                    );
                }
                break;
            case State.Stopped:
            case State.Crashed:
                if (this.proc !== undefined) {
                    throw new ServerError(
                        this.name,
                        `State will become ${newState}, but proc is defined.`
                    );
                }
        }

        // Check that we are not leaving Unrecoverable.
        if (
            this.state.getState() === State.Unrecoverable
            && newState !== State.Unrecoverable
        ) {
            throw new ServerError(
                this.name,
                `State cannot change from ${this.state.getState()} ` +
                `to ${newState}.`
            );
        }

        this.state.setState(State[newState]);
    }

    /**
     * Start the server process, stopping any previously running process.
     *
     * After this call the server is *not* guaranteed to be `Running`. Use
     * `waitForRunning` for that.
     */
    public initiateStart(
        command: string,
        args?: readonly string[] | undefined,
        options?: StartOptions | undefined
    ): void {
        if (this.isState(State.Running) || this.isState(State.Ready)) {
            this.initiateStop();
        }

        this.waitForStopped().then(() => {
            // Start the process
            this.log(`Start "${command} ${args?.join(" ") ?? ""}"`);
            const proc = childProcess.spawn(
                command,
                args,
                { cwd: options?.cwd, env: options?.env }
            );

            if (options?.onStdout) {
                const onStdout = options.onStdout;
                proc.stdout.on("data", onStdout);
            }
            if (options?.onStderr) {
                const onStderr = options.onStderr;
                proc.stderr.on("data", onStderr);
            }

            proc.on("error", (err) => {
                this.log(`Server process error: ${err}`);
            });

            proc.on("exit", this.procExitCallback);

            this.proc = proc;
            this.setState(State.Running);
        }, err => {
            this.log(`Error while waiting for the server to stop: ${err}`);
        });
    }

    /**
     * Stop the server process.
     *
     * After this call the server is *not* guaranteed to be `Stopped`. Use
     * `waitForStopped` for that.
     */
    public initiateStop(): void {
        if (this.isState(State.Running) || this.isState(State.Ready)) {
            this.log(`Kill server process ${this.proc?.pid}.`);
            const proc = this.proc as childProcess.ChildProcessWithoutNullStreams;
            proc.removeListener("exit", this.procExitCallback);
            if (proc.pid !== undefined) {
                treeKill(proc.pid, "SIGKILL", (err) => {
                    if (err) {
                        this.log(`Failed to kill process tree of ${proc.pid}: ${err}`);
                        const succeeded = proc.kill("SIGKILL");
                        if (!succeeded) {
                            this.log(`Failed to kill process ${proc.pid}.`);
                        }
                        this.log("This is an unrecorevable error.");
                        this.setState(State.Unrecoverable);
                    } else {
                        // Success
                        this.proc = undefined;
                        this.setState(State.Stopped);
                    }
                });
            } else {
                this.log("The process id is undefined.");
            }
        } else {
            this.proc = undefined;
            this.setState(State.Stopped);
        }
    }

    /**
     * Mark the server as `Ready`, if it is not `Stopped` or `Crashed`.
     *
     * After this call the server will be `Ready`, unless a `waitForReady`
     * promise modified the state in the meantime.
     */
    public setReady(): void {
        if (this.isState(State.Stopped) || this.isState(State.Crashed)) {
            return;
        }
        this.setState(State.Ready);
    }

    /**
     * Return a promise that will resolve when the server becomes `Running`.
     * Only one promise - the last one - is allowed to modify the server state.
     */
    public waitForRunning(): Promise<void> {
        return this.state.waitForState(State[State.Running]);
    }

    /**
     * Return a promise that will resolve when the server becomes `Ready`.
     * Only one promise - the last one - is allowed to modify the server state.
     */
    public waitForReady(): Promise<void> {
        return this.state.waitForState(State[State.Ready]);
    }

    /**
     * Return a promise that will resolve when the server becomes `Stopped`.
     * Only one promise - the last one - is allowed to modify the server state.
     */
    public waitForStopped(): Promise<void> {
        return this.state.waitForState(State[State.Stopped]);
    }

    /**
     * Return a promise that will resolve when the server becomes `Crashed`.
     * Only one promise - the last one - is allowed to modify the server state.
     */
    public waitForCrashed(): Promise<void> {
        return this.state.waitForState(State[State.Crashed]);
    }

    /**
     * Return a promise that will resolve when the server becomes
     * `Unrecoverable`.
     */
    public waitForUnrecoverable(): Promise<void> {
        return this.state.waitForState(State[State.Unrecoverable]);
    }
}
