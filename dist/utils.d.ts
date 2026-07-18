export declare const makeRunId: () => string;
export declare const stableId: (...parts: Array<string | number | undefined>) => string;
export declare const ensureOutputDirectory: (root: string) => Promise<string>;
export declare const writeJson: (file: string, value: unknown) => Promise<void>;
export declare const normalizePath: (root: string, file: string) => string;
export declare const pathExists: (file: string) => Promise<boolean>;
export declare const commandExists: (command: string) => Promise<boolean>;
