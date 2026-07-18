import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { saveDiscoveredScenarios, saveScenarioCandidate } from "../src/knowledge.js";
import { buildBusinessMap } from "../src/business-map/build.js";
import { auditProjectBusiness } from "../src/project-audit/audit.js";
import { buildProjectReport } from "../src/project-report/build.js";
import {
  analyzeProjectImpact,
  parseGitNameStatus,
  rangeFromBase,
  readGitChanges,
  updateProjectFromGit,
  validateGitRange,
} from "../src/project-report/update.js";
import { DEFAULT_CONFIG } from "../src/defaults.js";
import type { BusinessMap, KnowledgeAtlasEntry } from "../src/types.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

const entry = (id: string, file: string): KnowledgeAtlasEntry => ({
  id,
  title: `场景 ${id}`,
  focus: `理解 ${id}`,
  summary: `${id} 业务`,
  priority: "normal",
  dependsOn: [],
  evidenceFiles: [file],
  status: "candidate",
  updatedAt: "2026-07-19T00:00:00.000Z",
});

const mapFor = (root: string, id: string, file: string): BusinessMap => ({
  schemaVersion: 1,
  createdAt: "2026-07-19T00:00:00.000Z",
  root,
  title: `场景 ${id}`,
  focus: `理解 ${id}`,
  summary: `${id} 业务`,
  chapters: [{ id: "main", title: "主流程", summary: "主流程", nodeIds: ["start", "result"] }],
  nodes: [
    { id: "start", label: "开始", kind: "scenario", summary: "开始", status: "fact", evidenceIds: ["source"] },
    { id: "result", label: "结果", kind: "outcome", summary: "完成", status: "fact", evidenceIds: ["source"] },
  ],
  edges: [{ id: "path", from: "start", to: "result", status: "fact", confidence: 1, evidenceIds: ["source"] }],
  evidence: [{ id: "source", kind: "source", description: "实现", location: { file, line: 1 }, confidence: 1 }],
  uncertainties: [],
});

const fixture = async (): Promise<string> => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "code-doctor-update-"));
  directories.push(root);
  await fs.mkdir(path.join(root, "src"));
  await fs.writeFile(path.join(root, "src", "a.ts"), "export const a = true;\n", "utf8");
  await fs.writeFile(path.join(root, "src", "b.ts"), "export const b = true;\n", "utf8");
  await saveDiscoveredScenarios(root, [entry("a", "src/a.ts"), entry("b", "src/b.ts"), entry("unknown", "src/unknown.ts")]);
  await saveScenarioCandidate({ root, id: "a", map: mapFor(root, "a", "src/a.ts") });
  await saveScenarioCandidate({ root, id: "b", map: mapFor(root, "b", "src/b.ts") });
  return root;
};

describe("project update", () => {
  it("拒绝 shell 注入 range，并通过参数数组执行 Git", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "code-doctor-update-safe-"));
    directories.push(root);
    const marker = path.join(root, "owned");
    expect(() => validateGitRange(`HEAD;touch${marker}`)).toThrow("不安全字符");
    expect(() => validateGitRange("--output=/tmp/owned")).toThrow();
    expect(rangeFromBase("origin/main")).toBe("origin/main...HEAD");
    await expect(readGitChanges(root, `HEAD;touch${marker}`)).rejects.toThrow("不安全字符");
    await expect(fs.access(marker)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("解析删除和重命名，并用新旧路径关联场景", async () => {
    const root = await fixture();
    const project = (await buildProjectReport(root)).report;
    const parsed = parseGitNameStatus("D\0src/a.ts\0R100\0src/b.ts\0src/b-new.ts\0M\0src/unowned.ts\0");
    expect(parsed).toEqual([
      { path: "src/a.ts", status: "deleted" },
      { path: "src/b-new.ts", previousPath: "src/b.ts", status: "renamed" },
      { path: "src/unowned.ts", status: "modified" },
    ]);
    const impact = analyzeProjectImpact({ changes: parsed, project, config: DEFAULT_CONFIG });
    expect(impact.impactedScenarios.map((scenario) => scenario.id)).toEqual(["a", "b"]);
    expect(impact.unattributedFiles).toEqual(["src/unowned.ts"]);
    expect(impact.unknownBoundaries.join("\n")).toContain("删除或重命名");
    expect(impact.unknownBoundaries.join("\n")).toContain("尚未归属任何场景");
    expect(impact.unknownBoundaries.join("\n")).toContain("尚未建图");
  });

  it("只串行重建受影响场景，持久化未归属与审计结果到唯一 HTML", async () => {
    const root = await fixture();
    const calls: string[] = [];
    let active = 0;
    let peak = 0;
    const result = await updateProjectFromGit({ root, config: DEFAULT_CONFIG, range: "base...head" }, {
      readChanges: async () => [
        { path: "src/a.ts", status: "modified" },
        { path: "src/unowned.ts", status: "added" },
        { path: "package.json", status: "modified" },
      ],
      commit: async () => "abcdef1234567890",
      buildMap: async (input) => {
        active += 1;
        peak = Math.max(peak, active);
        calls.push(input.scenarioId!);
        await new Promise((resolve) => setTimeout(resolve, 2));
        const map = mapFor(root, input.scenarioId!, `src/${input.scenarioId}.ts`);
        const knowledge = await saveScenarioCandidate({ root, id: input.scenarioId, map });
        active -= 1;
        return { map, jsonFile: "", htmlFile: "", knowledge };
      },
      audit: async ({ root: auditRoot, config }) => auditProjectBusiness({ root: auditRoot, config, useAgent: false }),
    });

    expect(calls).toEqual(["a"]);
    expect(peak).toBe(1);
    expect(result.impact).toMatchObject({ range: "base...head", status: "completed", unattributedFiles: ["src/unowned.ts", "package.json"], audit: { status: "completed", agentStatus: "skipped" } });
    expect(result.impact.changedFiles.find((file) => file.path === "package.json")?.global).toBe(true);
    expect(result.impact.unchangedScenarioIds).toEqual(expect.arrayContaining(["b", "unknown"]));
    expect(result.report.impact?.range).toBe("base...head");
    const html = await fs.readFile(result.htmlFile, "utf8");
    expect(html).toContain("最近 Git 变更影响");
    expect(html).toContain("src/unowned.ts");
    await expect(fs.access(result.impactFile)).resolves.toBeUndefined();
  });

  it("limit 后按同一范围恢复，--no-agent 明确保留未重建边界", async () => {
    const root = await fixture();
    const calls: string[] = [];
    const overrides = {
      readChanges: async () => [
        { path: "src/a.ts", status: "modified" as const },
        { path: "src/b.ts", status: "modified" as const },
      ],
      commit: async () => "abcdef1234567890",
      buildMap: async (input: Parameters<typeof buildBusinessMap>[0]) => {
        const id = input.scenarioId!;
        calls.push(id);
        const map = mapFor(root, id, `src/${id}.ts`);
        const knowledge = await saveScenarioCandidate({ root, id, map });
        return { map, jsonFile: "", htmlFile: "", knowledge };
      },
      audit: async ({ root: auditRoot, config }: { root: string; config: typeof DEFAULT_CONFIG }) => auditProjectBusiness({ root: auditRoot, config, useAgent: false }),
    };
    const first = await updateProjectFromGit({ root, config: DEFAULT_CONFIG, range: "base...head", limit: 1 }, overrides);
    expect(calls).toEqual(["a"]);
    expect(first.impact.status).toBe("partial");
    const second = await updateProjectFromGit({ root, config: DEFAULT_CONFIG, range: "base...head", limit: 1 }, overrides);
    expect(calls).toEqual(["a", "b"]);
    expect(second.impact.status).toBe("completed");

    const noAgent = await updateProjectFromGit({ root, config: DEFAULT_CONFIG, range: "other...head", useAgent: false }, overrides);
    expect(noAgent.impact.impactedScenarios.every((scenario) => scenario.status === "skipped_no_agent")).toBe(true);
    expect(noAgent.impact.unknownBoundaries.join("\n")).toContain("--no-agent");
  });

  it("仍有待处理场景且审计失败时不会误报为已完成", async () => {
    const root = await fixture();
    const result = await updateProjectFromGit({ root, config: DEFAULT_CONFIG, range: "base...head", limit: 1 }, {
      readChanges: async () => [
        { path: "src/a.ts", status: "modified" },
        { path: "src/b.ts", status: "modified" },
      ],
      commit: async () => "abcdef1234567890",
      buildMap: async (input) => {
        const id = input.scenarioId!;
        const map = mapFor(root, id, `src/${id}.ts`);
        const knowledge = await saveScenarioCandidate({ root, id, map });
        return { map, jsonFile: "", htmlFile: "", knowledge };
      },
      audit: async () => { throw new Error("审计服务暂不可用"); },
    });

    expect(result.impact.status).toBe("partial_with_failures");
    expect(result.impact.impactedScenarios).toContainEqual(expect.objectContaining({ id: "b", status: "pending" }));
    expect(result.impact.unknownBoundaries.join("\n")).toContain("审计服务暂不可用");
  });
});
