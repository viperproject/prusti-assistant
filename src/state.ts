import * as util from "./util";

/**
 * This module keeps a global state and allows clients to wait for the
 * following events:
 *  - The extension has been fully activated.
 *  - A change to the settings has been fully processed.
 */

let isExtensionActive = false;

export type Listener = () => void;

const waitingForExtensionActivation: Listener[] = [];

export function waitExtensionActivation(): Promise<void> {
    return new Promise(resolve => {
        if (isExtensionActive) {
            // Resolve immediately
            resolve();
        } else {
            waitingForExtensionActivation.push(resolve);
        }
    });
}

export function notifyExtensionActivation(): void {
    util.log("The extension is now active.");
    isExtensionActive = true;
    waitingForExtensionActivation.forEach(listener => listener());
}

const waitingForConfigUpdate: Listener[] = [];

export function waitConfigUpdate(): Promise<void> {
    util.log("waitConfigUpdate");
    return new Promise(resolve => {
        waitingForConfigUpdate.push(resolve);
    });
}

export function notifyConfigUpdate(): void {
    util.log("The configuration has been updated.");
    waitingForConfigUpdate.forEach(listener => listener());
}
