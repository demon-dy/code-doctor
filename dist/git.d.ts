import type { CodeDoctorConfig, Diagnostic } from "./types.js";
export declare const assertCleanWorktree: (root: string) => Promise<void>;
export declare const currentBranch: (root: string) => Promise<string>;
export declare const createDoctorBranch: (root: string, diagnostic: Diagnostic) => Promise<string>;
export declare const changedStats: (root: string) => Promise<{
    files: number;
    added: number;
    deleted: number;
}>;
export declare const commitDoctorFix: (input: {
    root: string;
    diagnostic: Diagnostic;
}) => Promise<string>;
export declare const pushAndCreateMergeRequest: (input: {
    root: string;
    branch: string;
    diagnostic: Diagnostic;
    config: CodeDoctorConfig;
}) => Promise<string>;
export declare const restoreBranch: (root: string, branch: string) => Promise<void>;
