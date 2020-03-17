import * as fs from 'fs-extra';

import { DependencyInstaller, Location, ProgressListener } from './Dependency';

export class LocalReference implements DependencyInstaller {
	constructor(
		readonly referencePath: string
	) { }

	public async install(location: Location, shouldUpdate: boolean, progressListener: ProgressListener): Promise<Location> {
		if (!await fs.pathExists(this.referencePath)) {
			throw new Error(`Can't create a local reference to the nonexistent location ${this.referencePath}`);
		}
		return new Location(this.referencePath);
	}
}
