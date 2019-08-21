'use strict';

import * as util from './util';

export enum Event {
    StartExtensionActivation,
    EndExtensionActivation,
    StartPrustiUpdate,
    EndPrustiUpdate,
    StartVerification,
    EndVerification
}

export type Listener = () => void;

const oneTimeListeners: Map<Event, Listener[]> = new Map();

/**
 * Register a **one-time** listener
 */
function register(event: Event, listener: Listener) {
    let listeners = oneTimeListeners.get(event);
    if (!listeners) {
        listeners = [];
        oneTimeListeners.set(event, listeners);
    }
    listeners.push(listener);
}

/**
 * Wait for a particular event.
 */
export function wait(event: Event) {
    return new Promise(resolve => {
        register(event, resolve);
    });
}

export function notify(event: Event) {
    util.log(`Notify event: ${Event[event]}`);
    const listeners = oneTimeListeners.get(event);
    oneTimeListeners.delete(event);
    if (listeners) {
        listeners.forEach(listener => listener());
    }
}
