import path from "node:path";
import { checkBusinessRequirement } from "./business-map/check.js";
import { listRules, listScenarios, loadScenario } from "./knowledge.js";
import { runCommand } from "./process.js";
import type { BusinessAuditReport, CodeDoctorConfig, KnowledgeAtlasEntry } from "./types.js";
import { ensureOutputDirectory, writeJson } from "./utils.js";

export interface AuditExecution {
  mode: "changed" | "deep";
  createdAt: string;
  range?: string;
  changedFiles: string[];
  uncoveredFiles: string[];
  selectedScenarios: Array<{ id: string; title: string; status: string }>;
  deferredScenarios: Array<{ id: string; title: string; status: string }>;
  reports: Array<{ scenarioId: string; report: BusinessAuditReport; reportFile: string; htmlFile: string }>;
}

const normalizedChangedFiles = async (root: string, range: string): Promise<string[]> => {
  if (!/^[A-Za-z0-9._/@~^:{}+\-]+$/.test(range)) throw new Error("Git range 包含不安全字符");
  const result = await runCommand({ command: `git diff --name-only ${JSON.stringify(range)} --`, cwd: root });
  if (result.exitCode !== 0) throw new Error(`无法读取 Git 变更范围 ${range}：${result.stderr || result.stdout}`);
  return [...new Set(result.stdout.split(/\r?\n/)
    .map((file) => file.trim().replaceAll("\\", "/"))
    .filter((file) => file && !file.startsWith(".code-doctor/")))];
};

const evidenceFiles = (record: Awaited<ReturnType<typeof loadScenario>>): Set<string> =>
  new Set(record.map.evidence.flatMap((item) => item.location?.file ? [item.location.file.replaceAll("\\", "/")] : []));

const selectChangedScenarios = async (root: string, entries: KnowledgeAtlasEntry[], changedFiles: string[]): Promise<{
  selected: Array<{ entry: KnowledgeAtlasEntry; record: Awaited<ReturnType<typeof loadScenario>> }>;
  coveredFiles: Set<string>;
}> => {
  const selected: Array<{ entry: KnowledgeAtlasEntry; record: Awaited<ReturnType<typeof loadScenario>> }> = [];
  const coveredFiles = new Set<string>();
  for (const entry of entries) {
    const record = await loadScenario(root, entry.id).catch(() => undefined);
    if (!record) continue;
    const files = evidenceFiles(record);
    const matched = changedFiles.filter((file) => files.has(file));
    if (!matched.length) continue;
    matched.forEach((file) => coveredFiles.add(file));
    selected.push({ entry, record });
  }
  selected.sort((a, b) => Number(b.entry.status === "reviewed") - Number(a.entry.status === "reviewed"));
  return { selected, coveredFiles };
};

const runScenarioAudit = async (input: {
  root: string;
  config: CodeDoctorConfig;
  entry: KnowledgeAtlasEntry;
  map: Awaited<ReturnType<typeof loadScenario>>["map"];
  requirement: string;
}): Promise<AuditExecution["reports"][number]> => {
  const rules = await listRules(input.root, input.entry.id);
  const ruleContext = rules.length
    ? `\n人工确认的业务规则（必须逐条对照实现）：\n${rules.map((rule, index) => `${index + 1}. [${rule.id}] ${rule.statement}（确认人：${rule.confirmedBy}）`).join("\n")}`
    : "\n当前场景没有人工确认的业务规则；只能审计实现风险，不能断言产品需求错误。";
  const result = await checkBusinessRequirement({
    root: input.root,
    config: input.config,
    requirement: `${input.requirement}${ruleContext}`,
    map: input.map,
    artifactId: input.entry.id,
  });
  return { scenarioId: input.entry.id, ...result };
};

const writeExecution = async (root: string, execution: AuditExecution): Promise<void> => {
  const output = await ensureOutputDirectory(root);
  await writeJson(path.join(output, "audit-index.json"), execution);
};

export const auditChanged = async (input: {
  root: string;
  config: CodeDoctorConfig;
  range: string;
  one?: boolean;
}): Promise<AuditExecution> => {
  const changedFiles = await normalizedChangedFiles(input.root, input.range);
  const entries = await listScenarios(input.root);
  const { selected, coveredFiles } = await selectChangedScenarios(input.root, entries, changedFiles);
  const limit = input.one ? 1 : input.config.audit.maxScenariosPerRun;
  const targets = selected.slice(0, limit);
  const execution: AuditExecution = {
    mode: "changed",
    createdAt: new Date().toISOString(),
    range: input.range,
    changedFiles,
    uncoveredFiles: changedFiles.filter((file) => !coveredFiles.has(file)),
    selectedScenarios: targets.map(({ entry }) => ({ id: entry.id, title: entry.title, status: entry.status })),
    deferredScenarios: selected.slice(limit).map(({ entry }) => ({ id: entry.id, title: entry.title, status: entry.status })),
    reports: [],
  };
  for (const { entry, record } of targets) {
    execution.reports.push(await runScenarioAudit({
      root: input.root,
      config: input.config,
      entry,
      map: record.map,
      requirement: `审计 Git 变更 ${input.range} 对业务场景“${entry.title}”的影响。变更文件：${changedFiles.join(", ")}。检查业务路径、判断条件、最终结果、不可达分支和前后端语义是否发生非预期变化；证据不足必须明确说明。`,
    }));
  }
  await writeExecution(input.root, execution);
  return execution;
};

export const auditDeep = async (input: {
  root: string;
  config: CodeDoctorConfig;
  one?: boolean;
}): Promise<AuditExecution> => {
  const entries = await listScenarios(input.root);
  const limit = input.one ? 1 : input.config.audit.maxScenariosPerRun;
  const candidates = entries
    .sort((a, b) => Number(b.status === "reviewed") - Number(a.status === "reviewed"));
  const available: Array<{ entry: KnowledgeAtlasEntry; record: Awaited<ReturnType<typeof loadScenario>> }> = [];
  for (const entry of candidates) {
    const record = await loadScenario(input.root, entry.id).catch(() => undefined);
    if (record) available.push({ entry, record });
  }
  const dayIndex = Math.floor(Date.now() / 86_400_000);
  const targets = input.one && available.length
    ? [available[dayIndex % available.length]!]
    : available.slice(0, limit);
  const execution: AuditExecution = {
    mode: "deep",
    createdAt: new Date().toISOString(),
    changedFiles: [],
    uncoveredFiles: [],
    selectedScenarios: targets.map(({ entry }) => ({ id: entry.id, title: entry.title, status: entry.status })),
    deferredScenarios: available.filter(({ entry }) => !targets.some((target) => target.entry.id === entry.id)).map(({ entry }) => ({ id: entry.id, title: entry.title, status: entry.status })),
    reports: [],
  };
  for (const { entry, record } of targets) {
    execution.reports.push(await runScenarioAudit({
      root: input.root,
      config: input.config,
      entry,
      map: record.map,
      requirement: `对业务场景“${entry.title}”进行一次深度历史审计。主动寻找不可达结果、矛盾条件、缺失异常路径、无调用入口、前后端状态不一致、频控与时序风险，并区分代码事实、业务未知和需要运行验证的假设。`,
    }));
  }
  await writeExecution(input.root, execution);
  return execution;
};
