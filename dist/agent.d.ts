import type { AgentConfig, AgentRunResult, Diagnostic } from "./types.js";
export interface RepairTask {
    schemaVersion: 1;
    diagnostic: Diagnostic;
    constraints: {
        maxChangedFiles: number;
        maxChangedLines: number;
        mustAddOrUpdateTests: boolean;
        forbiddenActions: string[];
    };
    verificationCommands: string[];
}
export declare const createRepairTask: (input: {
    root: string;
    diagnostic: Diagnostic;
    maxChangedFiles: number;
    maxChangedLines: number;
    verificationCommands: string[];
}) => Promise<{
    task: RepairTask;
    taskFile: string;
    promptFile: string;
}>;
export declare const runRepairAgent: (input: {
    root: string;
    config: AgentConfig;
    promptFile: string;
}) => Promise<AgentRunResult>;
