
export class StateMachineError extends Error {
    constructor(public name: string, m: string) {
        super(m);

        // Set the prototype explicitly.
        Object.setPrototypeOf(this, StateMachineError.prototype);
    }
}

type ResolveReject = { resolve: () => void, reject: (err: Error) => void };

export class StateMachine<State extends string> {
    private readonly name: string;
    private currentState: State;
    private waitingForState: Map<State, ResolveReject[]> = new Map();

    /**
     * Construct a new state machine.
     */
    public constructor(
        name: string,
        initialState: State,
    ) {
        this.name = name;
        this.currentState = initialState;
    }

    /**
     * Return the current state.
     */
    public getState(): State {
        return this.currentState;
    }

    /*
     * Get a value of `waitingForState`, inserting an empty array if the key doesn't exist.
     */
    private getWaitingForState(state: State): ResolveReject[] {
        let callbacks = this.waitingForState.get(state);
        if (callbacks === undefined) {
            callbacks = [];
            this.waitingForState.set(state, callbacks);
        }
        return callbacks;
    }

    /**
     * Set a new state.
     */
    public setState(newState: State): void {
        this.currentState = newState;

        const callbacks: ResolveReject[] = this.getWaitingForState(newState);

        let badCallback = undefined;
        while (callbacks.length) {
            const { resolve, reject } = callbacks.shift() as ResolveReject;

            if (badCallback === undefined) {
                resolve();
            } else {
                reject(new StateMachineError(
                    this.name,
                    `After the state become "${newState}" the promise ` +
                    `resolution of (1) modified the state to ` +
                    `"${this.currentState}" before the promise resolution ` +
                    `of (2) - waiting for the state to become "${newState}" ` +
                    `- could run.\n(1): ${badCallback}\n(2): ${resolve}`
                ));
            }

            if (this.currentState !== newState) {
                badCallback = resolve;
            }
        }
    }

    /**
     * Return a promise that will resolve when the state becomes `targetState`.
     * Only one promise - the last one - is allowed to modify the state.
     * If a promise modifies the state any further promise will be rejected.
     */
    public waitForState(targetState: State): Promise<void> {
        return new Promise((resolve, reject) => {
            if (this.currentState === targetState) {
                resolve();
            } else {
                this.getWaitingForState(targetState).push({ resolve, reject });
            }
        });
    }
}
