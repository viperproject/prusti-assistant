
export class StateMachineError extends Error {
    constructor(public name: string, m: string) {
        super(m);

        // Set the prototype explicitly.
        Object.setPrototypeOf(this, StateMachineError.prototype);
    }
}

type ResolveReject = { resolve: () => void, reject: (err: Error) => void };

interface WaitingForState {
    [details: string]: ResolveReject[];
} 

export class StateMachine {
    private name: string;
    private currentState: string;
    private validStates: string[];
    private log: (data: string) => void;
    private waitingForState: WaitingForState = {};

    /**
     * Construct a new state machine.
     * 
     * @throw Will throw an error if `currentState` is not among the \
     *        `validStates`.
     */
    public constructor(
        name: string,
        initialState: string,
        validStates: string[],
        log?: (data: string) => void
    ) {
        this.name = name;
        this.validStates = [...validStates];
        this.log = (data) => (log || console.log)(`[${this.name}] ${data}`);
        for (const state of validStates) {
            this.waitingForState[state] = []
        }

        this.log(`Set initial state to "${initialState}".`);

        if (!this.validStates.includes(initialState)) {
            throw new StateMachineError(
                this.name,
                `Tried to set an invalid initial ` +
                `state "${initialState}". Valid states are: ${this.validStates}`
            );
        }
        this.currentState = initialState;
    }

    /**
     * Return the current state.
     */
    public getState(): string {
        return this.currentState;
    }

    /**
     * Set a new state.
     *
     * @throw Will throw an error if `newState` is not a valid state.
     */
    public setState(newState: string): void {
        this.log(`Set state to "${newState}".`);

        if (!this.validStates.includes(newState)) {
            throw new StateMachineError(
                this.name,
                `Tried to set an invalid initial state "${newState}". ` +
                `Valid states are: ${this.validStates}`
            );
        }

        this.currentState = newState;
    
        const callbacks: ResolveReject[] = this.waitingForState[newState]

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
     * 
     * @throw Will throw an error if `targetState` is not a valid state.
     */
    public waitForState(targetState: string): Promise<void> {
        if (!this.validStates.includes(targetState)) {
            throw new StateMachineError(
                this.name,
                `Tried to wait for an invalid state "${targetState}". ` +
                `Valid states are: ${this.validStates}`
            );
        }

        return new Promise((resolve, reject) => {
            if (this.currentState === targetState) {
                resolve();
            } else {
                this.waitingForState[targetState].push({ resolve, reject });
            }
        });
    }
}
