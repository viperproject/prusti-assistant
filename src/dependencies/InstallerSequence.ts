import { DependencyInstaller, Location, ProgressListener } from './Dependency';

export class InstallerSequence {
	constructor(readonly installers: DependencyInstaller[]) {
		// TODO flatten nested sequences?
	}

	public async install(location: Location, shouldUpdate: boolean, progressListener: ProgressListener): Promise<Location> {
		let index = 0;
		const total = this.installers.length;
		for (const installer of this.installers) {
			location = await installer.install(location, shouldUpdate, (fraction, message) => {
				progressListener(
					(index + fraction) / total,
					`${message} (step ${index + 1} of ${total})`
				);
			});
			index++;
		}
		return location;
	}
}
