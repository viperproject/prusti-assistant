import * as path from 'path';
import * as fs from 'fs-extra';
import { platform } from 'os';

/**
 * Manages the installation for a dependency, maintaining separate installations for each source (in a folder using their name).
 */
export class Dependency<SourceName extends string> {
	public sources: Map<SourceName, DependencyInstaller>;

	constructor(
		readonly basePath: string,
		...sources: Array<[SourceName, DependencyInstaller]>
	) {
		this.sources = new Map(sources);
	}

	/**
	 * Ensures that the dependency from the given source is currently installed.
	 * If it's not yet installed, this method will install it, otherwise it won't do anything (except provide a way to access it).
	 */
	public ensureInstalled(sourceName: SourceName, progressListener: ProgressListener): Promise<Location> {
		return this.install(sourceName, false, progressListener);
	}

	/**
	 * Forces an update from the given source, replacing the current installation in the process.
	 */
	public async update(sourceName: SourceName, progressListener: ProgressListener): Promise<Location> {
		return this.install(sourceName, true, progressListener);
	}

	/**
	 * Ensures that the dependency from the given source is currently installed.
	 * This method is the combination of `ensureInstalled` and `update`, switching between the two based on `shouldUpdate`.
	 */
	public async install(sourceName: SourceName, shouldUpdate: boolean, progressListener: ProgressListener): Promise<Location> {
		const source = this.sources.get(sourceName);
		if (source === undefined) {
			throw new Error(`Dependency ${this.basePath} has no source named ${sourceName}`);
		}
		const local = this.localDependency(sourceName);

		local.mkdir();

		return source.install(local, shouldUpdate, progressListener);
	}

	private localDependency(sourceName: SourceName): Location {
		return new Location(path.join(this.basePath, `${sourceName.toString()}`));
	}
}

/**
 * A simple representation of a folder in the file system, with some convenient methods for navigating through the hierarchy.
 * A way to access files for a dependency once it's been downloaded and installed.
 * Also useful for passing around file system locations between `DependencyInstaller`s.
 */
export class Location {
	constructor(
		readonly basePath: string
	) {
		// TODO remove debug logging
		console.log(`creating location at ${basePath}`);
	}

	/** Returns a path within this location with the given path components. */
	public path(...components: string[]): string {
		return path.join(this.basePath, ...components);
	}

	/** Returns the path to an executable with the given name, appending .exe on windows. */
	public executable(name: string): string {
		return this.path(platform() === "win32" ? `${name}.exe` : name);
	}

	/** Returns a child location within this one with the given path components. */
	public child(...components: string[]): Location {
		return new Location(this.path(...components));
	}

	/** Returns the parent location of this one. */
	public enclosingFolder(): Location {
		return new Location(path.dirname(this.basePath));
	}

	/** Returns whether or not the folder this location represents currently exists on the file system. */
	public exists(): Promise<boolean> {
		return fs.pathExists(this.basePath);
	}

	/** Makes sure the folder this location represents exists, creating an empty one if it doesn't yet. */
	public mkdir(): Promise<void> {
		return fs.ensureDir(this.basePath);
	}
}

/**
 * Reports overall progress made within the current task.
 * `fraction` is the amount of progress (out of 1).
 * `step` is a user-facing short description of what is currently happening.
 */
export type ProgressListener = (fraction: number, step: string) => void;

export interface DependencyInstaller {
	/**
	 * Installs the dependency using the given location, returning a reference to the final location.
	 * 
	 * @param location a suggested place to install to.
	 * @param shouldUpdate whether or not to rerun the installation process even if it is already installed, effectively updating.
	 * @param progressListener a callback to report installation progress to, for e.g. a progress bar.
	 */
	install(location: Location, shouldUpdate: boolean, progressListener: ProgressListener): Promise<Location>;
}
