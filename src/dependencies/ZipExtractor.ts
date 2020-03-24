import * as extractZip from 'extract-zip';
import * as fs from 'fs-extra';
import { promisify } from 'util';

import { DependencyInstaller, Location, ProgressListener } from './Dependency';

/** Extracts the zip at the location provided to `install` to a folder named `targetName`. */
export class ZipExtractor implements DependencyInstaller {
	constructor(
		readonly targetName: string
	) { }

	public async install(location: Location, shouldUpdate: boolean, progressListener: ProgressListener): Promise<Location> {
		const target = location.enclosingFolder().child(this.targetName);
		if (!shouldUpdate && await target.exists()) { return target; }

		await fs.ensureDir(target.basePath);
		await fs.emptyDir(target.basePath);

		progressListener(0, "Unzipping…");

		let entriesHandled = 0;
		console.log("starting zip extraction");
		await promisify(extractZip)(location.basePath, {
			dir: target.basePath,
			onEntry: (_entry, zip) => {
				console.log("finished entry");
				entriesHandled++;
				progressListener(entriesHandled / zip.entryCount, "Unzipping…");
			}
		});
		console.log("finished zip extraction");

		// don't delete the original zip since that would cause it to get re-downloaded on next install
		return target;
	}
}
