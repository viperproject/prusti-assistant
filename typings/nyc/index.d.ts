declare module 'nyc' {
    class NYC {
      constructor(config?: unknown);
      createTempDirectory(): Promise<void>;
      writeCoverageFile(): Promise<void>;
    }
    export = NYC;
}