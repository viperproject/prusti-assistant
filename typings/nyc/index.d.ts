declare module 'nyc' {
    class NYC {
      constructor(config?: unknown);
      createTempDirectory(): Promise<void>;
      writeCoverageFile(): Promise<void>;
      wrap(): Promise<void>;
    }
    export = NYC;
}
