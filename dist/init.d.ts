export declare const initializeProject: (root: string) => Promise<string[]>;
export type CiMode = "mr" | "push" | "daily" | "both" | "all";
export declare const installGitLabCi: (root: string, mode?: CiMode) => Promise<string[]>;
