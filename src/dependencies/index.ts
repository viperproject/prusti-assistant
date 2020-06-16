export * from './PrustiLocation';
export * from './rustup';

import { withProgressInWindow, currentPlatform } from 'vs-verification-toolbox';
import * as vscode from 'vscode';

import * as config from '../config';
import * as util from '../util';
import * as notifier from '../notifier';
import { PrustiLocation } from './PrustiLocation';
import { prustiTools } from './prustiTools';

export async function installDependencies(context: vscode.ExtensionContext, shouldUpdate: boolean): Promise<PrustiLocation> {
    notifier.notify(notifier.Event.StartPrustiUpdate);

    try {
        const tools = prustiTools(currentPlatform!, context);
        const { result: location, didReportProgress } = await withProgressInWindow(
            `${shouldUpdate ? "Updating" : "Installing"} Prusti`,
            listener => tools.install(config.buildChannel(), shouldUpdate, listener)
        );
        const prusti = new PrustiLocation(location);

        // only notify user about success if we reported anything in between; otherwise there was nothing to be done.
        if (didReportProgress) {
            // TODO test when restart is necessary
            if (shouldUpdate) {
                util.userInfo("Prusti updated successfully. Please restart the IDE.", true, true);
            } else {
                util.userInfo("Prusti installed successfully.");
            }
        }

        return prusti;
    } catch (err) {
        util.userError(`Error installing Prusti: ${err}`);
        throw err;
    } finally {
        notifier.notify(notifier.Event.EndPrustiUpdate);
    }
}
