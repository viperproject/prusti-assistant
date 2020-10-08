import * as childProcess from "child_process";
import * as treeKill from 'tree-kill';
import { setFlagsFromString } from "v8";

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

export type Listener = () => void;

interface StartOptions {
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
    private onRunningCallbacks: ResolveReject[] = [];
    private onReadyCallbacks: ResolveReject[] = [];
    private onStoppedCallbacks: ResolveReject[] = [];
    private onCrashedCallbacks: ResolveReject[] = [];
    private log: (data: string) => void;
    private proc: childProcess.ChildProcessWithoutNullStreams | undefined;

    public constructor(log: (data: string) => void) {
        this.log = log;
    }

    /**
     * Set the state of the server
     */
    private setState(state: State) {
        this.log(`Mark server as '${state}'.`);

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
     * Resolve pending promises that were waiting for a new state.
     */
    private notifyOfNewState() {
        const initialState = this.state;
        let callbacks: ResolveReject[];

        if (this.state === State.Running) {
            callbacks = this.onRunningCallbacks;
        } else if (this.state === State.Ready) {
            callbacks = this.onReadyCallbacks;
        } else if (this.state === State.Stopped) {
            callbacks = this.onStoppedCallbacks;
        } else if(this.state === State.Crashed) {
            callbacks = this.onCrashedCallbacks;
        } else {
            throw new ServerError("Unreachable.");
        }

        let responsible = undefined;
        while (callbacks.length) {
            const { resolve, reject } = callbacks.shift() as ResolveReject;

            if (this.state === initialState) {
                resolve();
            } else {
                reject(new ServerError(
                    `After the server state become '${initialState}', promise \
                    resolution (1) modified the state to '${this.state}' \
                    before promise resolution (2) - also waiting for the state \
                    to become '${initialState}' - could run. \
                    (1): ${responsible}, (2): ${resolve}.`
                ));
            }

            if (this.state !== initialState) {
                responsible = resolve;
            }
        }
    }

    /**
     * Start the server process, stopping any previously running process.
     * After this call the server will be `Running`.
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
        console.log(`"Start '${command} ${args?.join(" ") ?? ""}'`);
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
     * Stop the server process. After this call the server will be `Stopped`.
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
     * Mark a running server (`Running` or `Ready`) as `Ready`, otherwise throw
     * an exception. After this call the server will be `Ready`.
     *
     * @throws {ServerError}
     */
    public setReady(): void {
        // Check that the state is not `Stopped` or `Crashed`.
        if (this.state === State.Stopped || this.state === State.Crashed ) {
            throw new ServerError(
                `Cannot mark a '${this.state}' server as 'Ready'.`
            )
        }

        this.setState(State.Ready);
    }

    /**
     * Return a promise that will resolve when the server becomes 'Running'.
     */
    public waitForRunning(): Promise<void> {
        return new Promise((resolve, reject) => {
            if (this.state === State.Running) {
                resolve();
            } else {
                this.onRunningCallbacks.push({ resolve, reject });
            }
        });
    }

    /**
     * Return a promise that will resolve when the server becomes 'Ready'.
     */
    public waitForReady(): Promise<void> {
        return new Promise((resolve, reject) => {
            if (this.state === State.Ready) {
                resolve();
            } else {
                this.onReadyCallbacks.push({ resolve, reject });
            }
        });
    }

    /**
     * Return a promise that will resolve when the server becomes 'Stopped'.
     */
    public waitForStopped(): Promise<void> {
        return new Promise((resolve, reject) => {
            if (this.state === State.Stopped) {
                resolve();
            } else {
                this.onStoppedCallbacks.push({ resolve, reject });
            }
        });
    }

    /**
     * Return a promise that will resolve when the server becomes 'Crashed'.
     */
    public waitForCrashed(): Promise<void> {
        return new Promise((resolve, reject) => {
            if (this.state === State.Crashed) {
                resolve();
            } else {
                this.onCrashedCallbacks.push({ resolve, reject });
            }
        });
    }
}
