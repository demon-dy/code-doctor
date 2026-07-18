import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { initializeKnowledge, knowledgeDirectory, listScenarios } from "../knowledge.js";
import { runCommand } from "../process.js";
import type {
  BusinessMap,
  KnowledgeAtlas,
  KnowledgeAtlasEntry,
  KnowledgeScenarioRecord,
  ProjectBusinessReport,
  ProjectReportScenario,
} from "../types.js";
import { ensureOutputDirectory, pathExists, writeJson } from "../utils.js";
import { renderProjectReport } from "./render.js";

const readYaml = async <T>(file: string): Promise<T | undefined> => {
  try {
    return YAML.parse(await fs.readFile(file, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
};

const readJson = async (file: string): Promise<unknown | undefined> => {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
};

const asMap = (value: unknown): { map: BusinessMap; sourceCommit?: string; updatedAt?: string } | undefined => {
  if (!value || typeof value !== "object") return undefined;
  const item = value as Partial<KnowledgeScenarioRecord> & Partial<BusinessMap>;
  // 兼容早期直接把 BusinessMap 写进 scenarios/*.json 的知识目录。
  const normalize = (map: BusinessMap): BusinessMap => ({
    ...map,
    chapters: Array.isArray(map.chapters) && map.chapters.length
      ? map.chapters
      : [{ id: "legacy-overview", title: "业务流程", summary: map.summary, nodeIds: map.nodes.map((node) => node.id) }],
    uncertainties: Array.isArray(map.uncertainties) ? map.uncertainties : [],
  });
  if (item.map && Array.isArray(item.map.nodes)) return { map: normalize(item.map), sourceCommit: item.sourceCommit, updatedAt: item.updatedAt };
  if (Array.isArray(item.nodes) && Array.isArray(item.edges) && Array.isArray(item.evidence)) {
    return { map: normalize(item as BusinessMap), updatedAt: item.createdAt };
  }
  return undefined;
};

const orphanScenarioEntries = async (root: string, known: Set<string>): Promise<KnowledgeAtlasEntry[]> => {
  const directory = path.join(knowledgeDirectory(root), "scenarios");
  const names = await fs.readdir(directory).catch(() => []);
  const ids = [...new Set(names
    .filter((name) => name.endsWith(".json"))
    .map((name) => name.replace(/\.candidate\.json$|\.json$/g, ""))
    .filter((id) => id && !known.has(id)))];
  const entries: KnowledgeAtlasEntry[] = [];
  for (const id of ids) {
    const files = scenarioFiles(root, id);
    const [reviewedValue, candidateValue] = await Promise.all([readJson(files.reviewed), readJson(files.candidate)]);
    const selected = asMap(candidateValue) ?? asMap(reviewedValue);
    if (!selected) continue;
    entries.push({
      id,
      title: selected.map.title,
      focus: selected.map.focus,
      summary: selected.map.summary,
      status: reviewedValue ? "reviewed" : "candidate",
      updatedAt: selected.updatedAt ?? selected.map.createdAt,
      candidateAvailable: Boolean(candidateValue),
      priority: "normal",
      dependsOn: [],
      evidenceFiles: selected.map.evidence.flatMap((evidence) => evidence.location?.file ? [evidence.location.file] : []),
    });
  }
  return entries;
};

const currentCommit = async (root: string): Promise<string | undefined> => {
  const result = await runCommand({ command: "git rev-parse HEAD", cwd: root });
  return result.exitCode === 0 ? result.stdout.trim() || undefined : undefined;
};

const changedEvidenceFiles = async (root: string, from: string, files: string[]): Promise<string[] | undefined> => {
  if (!files.length) return [];
  // sourceCommit 来自可持久化的知识文件，不能直接拼进 shell。这里只接受 Git 对象 ID，
  // 并先读取整个提交范围的变更，再在内存中与证据文件求交集。
  if (!/^[0-9a-f]{7,64}$/i.test(from)) return undefined;
  const result = await runCommand({
    command: `git diff --name-only ${from}..HEAD --`,
    cwd: root,
  });
  if (result.exitCode !== 0) return undefined;
  const evidenceFiles = new Set(files.map((file) => file.replaceAll("\\", "/")));
  return result.stdout
    .split(/\r?\n/)
    .map((file) => file.trim().replaceAll("\\", "/"))
    .filter((file) => file && evidenceFiles.has(file));
};

const scenarioFiles = (root: string, id: string): { reviewed: string; candidate: string } => {
  const directory = path.join(knowledgeDirectory(root), "scenarios");
  return {
    reviewed: path.join(directory, `${id}.json`),
    candidate: path.join(directory, `${id}.candidate.json`),
  };
};

const buildScenario = async (
  root: string,
  entry: KnowledgeAtlasEntry,
  head: string | undefined,
): Promise<ProjectReportScenario> => {
  const files = scenarioFiles(root, entry.id);
  const [reviewedValue, candidateValue] = await Promise.all([readJson(files.reviewed), readJson(files.candidate)]);
  const reviewed = asMap(reviewedValue);
  const candidate = asMap(candidateValue);
  const selected = candidate ?? reviewed;
  const state: ProjectReportScenario["state"] = candidate && reviewed
    ? "pending_review"
    : reviewed
      ? "reviewed"
      : candidate
        ? "mapped"
        : "unmapped";
  const evidenceFiles = [...new Set([
    ...(entry.evidenceFiles ?? []),
    ...(selected?.map.evidence.flatMap((evidence) => evidence.location?.file ? [evidence.location.file] : []) ?? []),
  ])].sort();
  const missingEvidenceFiles = (await Promise.all(evidenceFiles.map(async (file) => await pathExists(path.resolve(root, file)) ? undefined : file)))
    .filter((file): file is string => Boolean(file));
  let freshness: ProjectReportScenario["freshness"] = "unknown";
  let changed: string[] = [];
  if (selected?.sourceCommit && head) {
    if (selected.sourceCommit === head) freshness = "current";
    else {
      const filesChanged = await changedEvidenceFiles(root, selected.sourceCommit, evidenceFiles);
      if (filesChanged) {
        changed = filesChanged;
        freshness = filesChanged.length ? "stale" : "current";
      }
    }
  }
  return {
    id: entry.id,
    title: entry.title,
    focus: entry.focus || entry.title,
    summary: entry.summary ?? selected?.map.summary,
    priority: entry.priority ?? "normal",
    dependsOn: entry.dependsOn ?? [],
    evidenceFiles,
    missingEvidenceFiles,
    state,
    freshness,
    updatedAt: selected?.updatedAt ?? entry.updatedAt,
    sourceCommit: selected?.sourceCommit,
    changedEvidenceFiles: changed,
    map: selected?.map,
  };
};

export const buildProjectReport = async (root: string): Promise<{
  report: ProjectBusinessReport;
  jsonFile: string;
  htmlFile: string;
}> => {
  await initializeKnowledge(root);
  const knowledge = knowledgeDirectory(root);
  const [atlasEntries, atlasDocument, project, candidateProject, head] = await Promise.all([
    listScenarios(root),
    readYaml<KnowledgeAtlas>(path.join(knowledge, "atlas.yaml")),
    readYaml<{ name?: string; summary?: string }>(path.join(knowledge, "project.yaml")),
    readYaml<{ summary?: string }>(path.join(knowledge, "project.candidate.yaml")),
    currentCommit(root),
  ]);
  const atlas = [...atlasEntries, ...await orphanScenarioEntries(root, new Set(atlasEntries.map((entry) => entry.id)))];
  const scenarios = await Promise.all(atlas.map((entry) => buildScenario(root, entry, head)));
  const confirmedSummary = project?.summary?.trim() ?? "";
  const candidateSummary = candidateProject?.summary?.trim() ?? "";
  const summary = confirmedSummary || candidateSummary || "尚未形成项目业务定位。";
  const evidenceFiles = new Set(scenarios.flatMap((scenario) => scenario.evidenceFiles));
  const missingFiles = new Set(scenarios.flatMap((scenario) => scenario.missingEvidenceFiles));
  const mapped = scenarios.filter((scenario) => scenario.state !== "unmapped").length;
  const reviewed = scenarios.filter((scenario) => scenario.state === "reviewed" || scenario.state === "pending_review").length;
  const pendingReview = scenarios.filter((scenario) => scenario.state === "pending_review").length;
  const unknownBoundaries: string[] = [];
  if (!confirmedSummary && candidateSummary) unknownBoundaries.push("项目定位仍是 AI 候选，尚未经过人工确认。");
  if (!atlas.length) unknownBoundaries.push("尚未运行全项目业务发现，当前没有业务场景目录。");
  const unmapped = scenarios.filter((scenario) => scenario.state === "unmapped");
  if (unmapped.length) unknownBoundaries.push(`${unmapped.length} 个候选业务场景尚未建图，无法判断其内部链路是否完整。`);
  if (missingFiles.size) unknownBoundaries.push(`${missingFiles.size} 个证据文件不存在，相关结论无法从当前工作区复核。`);
  for (const scenario of scenarios) {
    if (scenario.freshness === "stale") unknownBoundaries.push(`“${scenario.title}”的证据代码在建图后发生变化，需要重新审计。`);
    for (const uncertainty of scenario.map?.uncertainties ?? []) unknownBoundaries.push(`“${scenario.title}”：${uncertainty}`);
    const uncertainNodes = scenario.map?.nodes.filter((node) => node.status === "unknown" || node.status === "conflicted").length ?? 0;
    if (uncertainNodes) unknownBoundaries.push(`“${scenario.title}”包含 ${uncertainNodes} 个未知或证据冲突节点。`);
  }
  const report: ProjectBusinessReport = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    root,
    project: {
      name: project?.name?.trim() || path.basename(root),
      summary,
      summaryStatus: confirmedSummary ? "confirmed" : candidateSummary ? "candidate" : "empty",
    },
    atlasUpdatedAt: atlasDocument?.updatedAt,
    sourceCommit: head,
    scenarios,
    coverage: {
      discovered: scenarios.length,
      mapped,
      reviewed,
      pendingReview,
      stale: scenarios.filter((scenario) => scenario.freshness === "stale").length,
      evidenceFiles: evidenceFiles.size,
      existingEvidenceFiles: evidenceFiles.size - missingFiles.size,
      mapPercent: scenarios.length ? Math.round(mapped * 100 / scenarios.length) : 0,
      reviewPercent: scenarios.length ? Math.round(reviewed * 100 / scenarios.length) : 0,
    },
    unknownBoundaries: [...new Set(unknownBoundaries)],
  };
  const output = await ensureOutputDirectory(root);
  const jsonFile = path.join(output, "project-report.json");
  const htmlFile = path.join(output, "project-report.html");
  await writeJson(jsonFile, report);
  await fs.writeFile(htmlFile, renderProjectReport(report), "utf8");
  return { report, jsonFile, htmlFile };
};
