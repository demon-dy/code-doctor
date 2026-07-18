export interface CommandResult {
    command: string;
    exitCode: number;
    stdout: string;
    stderr: string;
    durationMs: number;
    timedOut: boolean;
}
export declare const runCommand: (input: {
    command: string;
    cwd: string;
    timeoutMs?: number;
    env?: NodeJS.ProcessEnv;
}) => Promise<CommandResult>;
