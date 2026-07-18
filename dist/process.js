import { spawn } from "node:child_process";
export const runCommand = async (input) => {
    const startedAt = Date.now();
    return new Promise((resolve, reject) => {
        const child = spawn("sh", ["-lc", input.command], {
            cwd: input.cwd,
            env: { ...process.env, ...input.env },
            stdio: ["ignore", "pipe", "pipe"],
        });
        let stdout = "";
        let stderr = "";
        let timedOut = false;
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (chunk) => (stdout += chunk));
        child.stderr.on("data", (chunk) => (stderr += chunk));
        const timer = setTimeout(() => {
            timedOut = true;
            child.kill("SIGTERM");
            setTimeout(() => child.kill("SIGKILL"), 2_000).unref();
        }, input.timeoutMs ?? 300_000);
        child.on("error", reject);
        child.on("close", (code) => {
            clearTimeout(timer);
            resolve({
                command: input.command,
                exitCode: code ?? 1,
                stdout,
                stderr,
                durationMs: Date.now() - startedAt,
                timedOut,
            });
        });
    });
};
/**
 * 直接执行可执行文件和参数，不经过 shell。Git ref、文件路径等外部输入必须优先
 * 使用这个入口，避免即使经过引号处理仍被 shell 展开。
 */
export const runCommandArgs = async (input) => {
    const startedAt = Date.now();
    return new Promise((resolve, reject) => {
        const child = spawn(input.file, input.args, {
            cwd: input.cwd,
            env: { ...process.env, ...input.env },
            stdio: ["ignore", "pipe", "pipe"],
            shell: false,
        });
        let stdout = "";
        let stderr = "";
        let timedOut = false;
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (chunk) => (stdout += chunk));
        child.stderr.on("data", (chunk) => (stderr += chunk));
        const timer = setTimeout(() => {
            timedOut = true;
            child.kill("SIGTERM");
            setTimeout(() => child.kill("SIGKILL"), 2_000).unref();
        }, input.timeoutMs ?? 300_000);
        child.on("error", reject);
        child.on("close", (code) => {
            clearTimeout(timer);
            resolve({
                command: [input.file, ...input.args].join(" "),
                exitCode: code ?? 1,
                stdout,
                stderr,
                durationMs: Date.now() - startedAt,
                timedOut,
            });
        });
    });
};
//# sourceMappingURL=process.js.map