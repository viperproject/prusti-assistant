import * as childProcess from "child_process";
import * as treeKill from "tree-kill";

/**
 * The state of the process of a server.
 */
enum State {
    /** A process that is running and has not yet been marked as ready. */
    Running,
    /** A running process that has been marked as ready. */
    Ready,
    /** A process that never started, or that has been explicitly stopped. */
    Stopped,
    /** A process that terminated without being explicely stopped. */
    Crashed,
}

export interface StartOptions {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    onStdout?: (data: string) => void;
    onStderr?: (data: string) => void;
}

export class ServerError extends Error {
    constructor(m: string) {
        super(m);

        // Set the prototype explicitly.
        Object.setPrototypeOf(this, ServerError.prototype);
    }
}

type ResolveReject = { resolve: () => void, reject: (err: Error) => void };

export class ServerManager {
    private state: State = State.Stopped;
    private proc: childProcess.ChildProcessWithoutNullStreams | undefined;
    private log: (data: string) => void;
    private callbacksWaitingForRunning: ResolveReject[] = [];
    private callbacksWaitingForReady: ResolveReject[] = [];
    private callbacksWaitingForStopped: ResolveReject[] = [];
    private callbacksWaitingForCrashed: ResolveReject[] = [];

    /**
     * Construct a new server manager.
     *
     * @param log: the function to be called to report log messages.
     */
    public constructor(log?: (data: string) => void) {
        this.log = log || console.log
    }

    /**
     * Set a new state of the server.
     */
    private setState(state: State) {
        this.log(`Mark server as "{state}"`);

        // Check class invariant
        switch (state) {
            case State.Ready:
            case State.Running:
                if (this.proc === undefined) {
                    throw new ServerError(
                        `State is ${state}, but proc is undefined.`
                    );
                }
                break;
            case State.Stopped:
            case State.Crashed:
                if (this.proc !== undefined) {
                    throw new ServerError(
                        `State is ${state}, but proc is not undefined.`
                    );
                }
        }

        this.state = state;
        this.notifyOfNewState();
    }

    /**
     * Resolve all pending promises that were waiting for a new state.
     *
     * The pending promises will be rejected if some previous promise
     * resolution or rejection modified the state of the server.
     */
    private notifyOfNewState() {
        const initialState = this.state;
        let callbacks: ResolveReject[];

        if (this.state === State.Running) {
            callbacks = this.callbacksWaitingForRunning;
        } else if (this.state === State.Ready) {
            callbacks = this.callbacksWaitingForReady;
        } else if (this.state === State.Stopped) {
            callbacks = this.callbacksWaitingForStopped;
        } else if(this.state === State.Crashed) {
            callbacks = this.callbacksWaitingForCrashed;
        } else {
            throw new ServerError("Unreachable.");
        }

        let badCallback = undefined;
        while (callbacks.length) {
            const { resolve, reject } = callbacks.shift() as ResolveReject;

            if (this.state === initialState) {
                resolve();
            } else {
                reject(new ServerError(
                    `After the server state become "{initialState}" promise \
                    resolution (1) modified the state to "{this.state}"\
                    before promise resolution (2) - also waiting for the state \
                    to become "{initialState}"- could run.\n\
                    (1): ${badCallback}\n(2): ${resolve}`
                ));
            }

            if (this.state !== initialState) {
                badCallback = resolve;
            }
        }
    }

    /**
     * Start the server process, stopping any previously running process.
     *
     * After this call the server will be `Running`, unless a `waitForRunning`
     * promise modified the state.
     */
    public start(
        command: string,
        args?: readonly string[] | undefined,
        options?: StartOptions | undefined
    ): void {
        if (this.state === State.Running || this.state === State.Ready) {
            this.stop();
        }

        // Start the process
        console.log(`Start "${command} ${args?.join(" ") ?? ""}"`);
        const proc = childProcess.spawn(
            command,
            args,
            { cwd: options?.cwd, env: options?.env }
        );

        proc.stdout.on("data", (data) => {
            console.log(`[stdout] ${data}`);
        });
        proc.stderr.on("data", (data) => {
            console.log(`[stderr] ${data}`);
        });

        if (options?.onStdout) {
            const onStdout = options.onStdout;
            proc.stdout.on("data", onStdout);
        }
        if (options?.onStderr) {
            const onStderr = options.onStderr;
            proc.stderr.on("data", onStderr);
        }

        proc.on("error", (err) => {
            console.log(`Server process error: ${err}`);
        });

        proc.on("exit", (code) => {
            console.log(`Server process terminated with exit code ${code}`);

            if (this.state !== State.Stopped) {
                console.log(`This is an unexpected termination.`);

                this.proc = undefined;
                this.setState(State.Crashed);
            }
        });

        this.proc = proc;
        this.setState(State.Running);
    }

    /**
     * Stop the server process.
     *
     * After this call the server will be `Stopped`, unless a `waitForStopped`
     * promise modified the state.
     */
    public stop(): void {
        if (this.state === State.Running || this.state === State.Ready) {
            this.log(`Kill process ${this.proc}`);
            const proc = this.proc as childProcess.ChildProcessWithoutNullStreams;
            treeKill(proc.pid, "SIGKILL", (err) => {
                if (err !== undefined) {
                    this.log(`Failed to kill process tree of ${proc.pid}: ${err}`);
                    const succeeded = proc.kill("SIGKILL");
                    if (!succeeded) {
                        this.log(`Failed to kill process ${proc}`);
                    }
                }
            });
        }

        this.proc = undefined;
        this.setState(State.Stopped);
    }

    /**
     * Mark the server as `Ready`, throwing an exception if the server is
     * `Stopped` or `Crashed`.
     *
     * After this call the server will be `Ready`, unless a `waitForReady`
     * promise modified the state.
     *
     * @throws {ServerError}
     */
    public setReady(): void {
        // Check that the state is not `Stopped` or `Crashed`.
        if (this.state === State.Stopped || this.state === State.Crashed ) {
            throw new ServerError(
                `Cannot mark a "{this.state}"server as "eady"`
            )
        }

        this.setState(State.Ready);
    }

    /**
     * Return a promise that will resolve when the server becomes `Running`.
     * Only one promise - the last one - is allowed to modify the server state.
     */
    public waitForRunning(): Promise<void> {
        return new Promise((resolve, reject) => {
            if (this.state === State.Running) {
                resolve();
            } else {
                this.callbacksWaitingForRunning.push({ resolve, reject });
            }
        });
    }

    /**
     * Return a promise that will resolve when the server becomes `Ready`.
     * Only one promise - the last one - is allowed to modify the server state.
     */
    public waitForReady(): Promise<void> {
        return new Promise((resolve, reject) => {
            if (this.state === State.Ready) {
                resolve();
            } else {
                this.callbacksWaitingForReady.push({ resolve, reject });
            }
        });
    }

    /**
     * Return a promise that will resolve when the server becomes `Stopped`.
     * Only one promise - the last one - is allowed to modify the server state.
     */
    public waitForStopped(): Promise<void> {
        return new Promise((resolve, reject) => {
            if (this.state === State.Stopped) {
                resolve();
            } else {
                this.callbacksWaitingForStopped.push({ resolve, reject });
            }
        });
    }

    /**
     * Return a promise that will resolve when the server becomes `Crashed`.
     * Only one promise - the last one - is allowed to modify the server state.
     */
    public waitForCrashed(): Promise<void> {
        return new Promise((resolve, reject) => {
            if (this.state === State.Crashed) {
                resolve();
            } else {
                this.callbacksWaitingForCrashed.push({ resolve, reject });
            }
        });
    }
}
