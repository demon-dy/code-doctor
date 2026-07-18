import path from "node:path";
import { createRepairTask, runRepairAgent } from "./agent.js";
import {
  assertCleanWorktree,
  changedStats,
  commitDoctorFix,
  createDoctorBranch,
  currentBranch,
  pushAndCreateMergeRequest,
  restoreBranch,
} from "./git.js";
import { runCommand } from "./process.js";
import { assertScanSucceeded, scanProject, selectOneDiagnostic } from "./scan.js";
import type { CodeDoctorConfig, DoctorRunRecord } from "./types.js";
import { ensureOutputDirectory, makeRunId, writeJson } from "./utils.js";

const discoverVerificationCommands = async (
  root: string,
  configured: string[],
): Promise<string[]> => {
  if (configured.length) return configured;
  const commands: string[] = [];
  const packageCheck = await runCommand({ command: "test -f package.json", cwd: root });
  if (packageCheck.exitCode === 0) {
    const scripts = await runCommand({
      command: "node -e 'const p=require(\"./package.json\"); console.log(JSON.stringify(p.scripts||{}))'",
      cwd: root,
    });
    try {
      const parsed = JSON.parse(scripts.stdout) as Record<string, string>;
      if (parsed.typecheck) commands.push("npm run typecheck");
      if (parsed.test) commands.push("npm test");
      else if (parsed.build) commands.push("npm run build");
    } catch {}
  }
  const goCheck = await runCommand({ command: "test -f go.mod", cwd: root });
  if (goCheck.exitCode === 0) commands.push("go test ./...");
  return commands;
};

interface VerificationRun {
  passed: boolean;
  results: Array<{
    command: string;
    exitCode: number;
    baselineExitCode?: number;
    passed: boolean;
    timedOut: boolean;
    durationMs: number;
    stdout: string;
    stderr: string;
  }>;
}

const runVerification = async (
  root: string,
  commands: string[],
  baseline?: VerificationRun,
): Promise<VerificationRun> => {
  const results: VerificationRun["results"] = [];
  for (const [index, command] of commands.entries()) {
    const result = await runCommand({ command, cwd: root, timeoutMs: 900_000 });
    const baselineResult = baseline?.results[index];
    const baselineExitCode = baselineResult?.exitCode;
    const passed = !result.timedOut && (
      result.exitCode === 0 ||
      (baselineExitCode !== undefined && baselineExitCode !== 0 && baselineResult?.timedOut === false)
    );
    results.push({
      command,
      exitCode: result.exitCode,
      baselineExitCode,
      passed,
      timedOut: result.timedOut,
      durationMs: result.durationMs,
      stdout: result.stdout,
      stderr: result.stderr,
    });
  }
  return { passed: results.every((result) => result.passed), results };
};

export const fixOneIssue = async (input: {
  root: string;
  config: CodeDoctorConfig;
  openMergeRequest: boolean;
}): Promise<DoctorRunRecord> => {
  const runId = makeRunId();
  const startedAt = new Date().toISOString();
  const output = await ensureOutputDirectory(input.root);
  const record: DoctorRunRecord = {
    schemaVersion: 1,
    runId,
    startedAt,
    finishedAt: startedAt,
    beforeCount: 0,
    resolved: false,
    verificationPassed: false,
  };
  let originalBranch: string | undefined;
  try {
    await assertCleanWorktree(input.root);
    originalBranch = await currentBranch(input.root);
    const before = await scanProject({ root: input.root, config: input.config });
    assertScanSucceeded(before);
    record.beforeCount = before.diagnostics.length;
    const selected = selectOneDiagnostic(before);
    if (!selected) {
      record.finishedAt = new Date().toISOString();
      await writeJson(path.join(output, "run.json"), record);
      return record;
    }
    record.selectedDiagnostic = selected;
    const verificationCommands = await discoverVerificationCommands(input.root, input.config.verify);
    const branch = await createDoctorBranch(input.root, selected);
    record.branch = branch;
    const verificationBaseline = await runVerification(input.root, verificationCommands);
    await writeJson(path.join(output, "verification-baseline.json"), verificationBaseline);
    const task = await createRepairTask({
      root: input.root,
      diagnostic: selected,
      maxChangedFiles: input.config.limits.maxChangedFiles,
      maxChangedLines: input.config.limits.maxChangedLines,
      verificationCommands,
    });
    const agent = await runRepairAgent({
      root: input.root,
      config: input.config.agent,
      promptFile: task.promptFile,
    });
    record.agent = {
      provider: agent.provider,
      command: agent.command,
      exitCode: agent.exitCode,
      durationMs: agent.durationMs,
    };
    if (agent.exitCode !== 0) throw new Error(`Agent 执行失败，退出码 ${agent.exitCode}`);
    const stats = await changedStats(input.root);
    if (stats.files === 0) throw new Error("Agent 没有产生代码修改");
    if (stats.files > input.config.limits.maxChangedFiles) {
      throw new Error(`修改文件数 ${stats.files} 超过限制 ${input.config.limits.maxChangedFiles}`);
    }
    if (stats.added + stats.deleted > input.config.limits.maxChangedLines) {
      throw new Error(`修改行数 ${stats.added + stats.deleted} 超过限制 ${input.config.limits.maxChangedLines}`);
    }
    const after = await scanProject({ root: input.root, config: input.config });
    assertScanSucceeded(after);
    record.afterCount = after.diagnostics.length;
    record.resolved = !after.diagnostics.some((diagnostic) => diagnostic.id === selected.id);
    if (!record.resolved) throw new Error("重新扫描后原诊断仍然存在");
    const verification = await runVerification(input.root, verificationCommands, verificationBaseline);
    await writeJson(path.join(output, "verification.json"), verification);
    record.verificationPassed = verification.passed;
    if (!record.verificationPassed) throw new Error("项目验证命令未通过");
    record.commit = await commitDoctorFix({ root: input.root, diagnostic: selected });
    if (input.openMergeRequest && input.config.gitlab.enabled) {
      record.mergeRequestUrl = await pushAndCreateMergeRequest({
        root: input.root,
        branch,
        diagnostic: selected,
        config: input.config,
      });
    }
  } catch (error) {
    record.error = (error as Error).message;
  } finally {
    record.finishedAt = new Date().toISOString();
    await writeJson(path.join(output, "run.json"), record);
    if (record.error && originalBranch) await restoreBranch(input.root, originalBranch);
  }
  return record;
};
