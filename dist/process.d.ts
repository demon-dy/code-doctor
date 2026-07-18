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
/**
 * 直接执行可执行文件和参数，不经过 shell。Git ref、文件路径等外部输入必须优先
 * 使用这个入口，避免即使经过引号处理仍被 shell 展开。
 */
export declare const runCommandArgs: (input: {
    file: string;
    args: string[];
    cwd: string;
    timeoutMs?: number;
    env?: NodeJS.ProcessEnv;
}) => Promise<CommandResult>;
