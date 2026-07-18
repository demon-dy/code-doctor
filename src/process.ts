import { spawn } from "node:child_process";

export interface CommandResult {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

export const runCommand = async (input: {
  command: string;
  cwd: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}): Promise<CommandResult> => {
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
    child.stdout.on("data", (chunk: string) => (stdout += chunk));
    child.stderr.on("data", (chunk: string) => (stderr += chunk));
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
