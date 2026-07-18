import path from "node:path";
import type { CodeDoctorConfig, Diagnostic, ScanReport, ScannerConfig } from "./types.js";
import { runCommand } from "./process.js";
import { discoverScanners } from "./scanners/auto.js";
import { parseDiagnostics } from "./scanners/parsers.js";
import { ensureOutputDirectory, makeRunId, writeJson } from "./utils.js";

const uniqueDiagnostics = (diagnostics: Diagnostic[]): Diagnostic[] => {
  const seen = new Set<string>();
  return diagnostics.filter((diagnostic) => {
    if (seen.has(diagnostic.id)) return false;
    seen.add(diagnostic.id);
    return true;
  });
};

const failureSummary = (stdout: string, stderr: string): string =>
  (stderr.trim() || stdout.trim() || "没有错误输出")
    .replaceAll(/\s+/g, " ")
    .slice(0, 500);

const resolveScanners = async (
  root: string,
  config: CodeDoctorConfig,
): Promise<ScannerConfig[]> => {
  const configured = config.scanners.filter((scanner) => scanner.enabled !== false);
  const discovered = await discoverScanners(root);
  return configured.flatMap((scanner) => scanner.command === "auto" ? discovered : [scanner]);
};

export const scanProject = async (input: {
  root: string;
  config: CodeDoctorConfig;
  writeReport?: boolean;
}): Promise<ScanReport> => {
  const runId = makeRunId();
  const diagnostics: Diagnostic[] = [];
  const scannerRuns: ScanReport["scanners"] = [];
  const scanners = await resolveScanners(input.root, input.config);

  for (const scanner of scanners) {
    const result = await runCommand({
      command: scanner.command,
      cwd: input.root,
      timeoutMs: scanner.timeoutMs,
    });
    let parsed: Diagnostic[] = [];
    let error: string | undefined;
    try {
      parsed = await parseDiagnostics({
        root: input.root,
        scanner: scanner.name,
        parser: scanner.parser,
        stdout: result.stdout,
        stderr: result.stderr,
      });
    } catch (parseError) {
      error = `无法解析扫描结果：${(parseError as Error).message}`;
      if (result.exitCode !== 0) {
        error += `；扫描器退出码 ${result.exitCode}：${failureSummary(result.stdout, result.stderr)}`;
      }
    }
    diagnostics.push(...parsed);
    if (!error && result.exitCode !== 0 && parsed.length === 0) {
      error = `扫描器退出码 ${result.exitCode}：${failureSummary(result.stdout, result.stderr)}`;
    }
    scannerRuns.push({
      name: scanner.name,
      command: scanner.command,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      diagnosticCount: parsed.length,
      error: result.timedOut ? "扫描超时" : error,
    });
  }

  const ignored = new Set(input.config.ignore);
  const report: ScanReport = {
    schemaVersion: 1,
    runId,
    createdAt: new Date().toISOString(),
    root: input.root,
    diagnostics: uniqueDiagnostics(diagnostics)
      .filter((diagnostic) => !ignored.has(diagnostic.id))
      .sort((left, right) => {
        const rank = { error: 0, warning: 1, info: 2 };
        return rank[left.severity] - rank[right.severity] || left.id.localeCompare(right.id);
      }),
    scanners: scannerRuns,
  };

  if (input.writeReport !== false) {
    const output = await ensureOutputDirectory(input.root);
    await writeJson(path.join(output, "diagnostics.json"), report);
  }
  return report;
};

export const scanFailureMessages = (report: ScanReport): string[] =>
  report.scanners.flatMap((scanner) =>
    scanner.error ? [`${scanner.name}: ${scanner.error}`] : [],
  );

export const assertScanSucceeded = (report: ScanReport): void => {
  const failures = scanFailureMessages(report);
  if (failures.length) throw new Error(`扫描失败：${failures.join("；")}`);
};

export const selectOneDiagnostic = (report: ScanReport): Diagnostic | undefined =>
  report.diagnostics[0];
