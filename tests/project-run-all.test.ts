import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildBusinessMap } from "../src/business-map/build.js";
import { listScenarios, saveDiscoveredScenarios, saveScenarioCandidate } from "../src/knowledge.js";
import { orderProjectScenarios, runAllProjectScenarios } from "../src/project-report/run-all.js";
import { DEFAULT_CONFIG } from "../src/defaults.js";
import type { BusinessMap, KnowledgeAtlasEntry } from "../src/types.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

const entry = (id: string, priority: KnowledgeAtlasEntry["priority"], dependsOn: string[] = []): KnowledgeAtlasEntry => ({
  id,
  title: `场景 ${id}`,
  focus: `理解场景 ${id}`,
  summary: `${id} 的业务流程`,
  priority,
  dependsOn,
  evidenceFiles: ["app.ts"],
  status: "candidate",
  updatedAt: "2026-07-19T00:00:00.000Z",
});

const mapFor = (root: string, id: string): BusinessMap => ({
  schemaVersion: 1,
  createdAt: "2026-07-19T00:00:00.000Z",
  root,
  title: `场景 ${id}`,
  focus: `理解场景 ${id}`,
  summary: `${id} 已经完成建图`,
  chapters: [{ id: "flow", title: "主流程", summary: "主流程", nodeIds: ["start"] }],
  nodes: [{ id: "start", label: "开始", kind: "scenario", summary: "开始流程", status: "fact", evidenceIds: ["source"] }],
  edges: [],
  evidence: [{ id: "source", kind: "source", description: "业务入口", location: { file: "app.ts", line: 1 }, confidence: 1 }],
  uncertainties: [],
});

const successfulMapBuilder = (root: string, calls: string[]) => async (input: Parameters<typeof buildBusinessMap>[0]) => {
  const id = input.scenarioId!;
  calls.push(id);
  const knowledge = await saveScenarioCandidate({ root, id, map: mapFor(root, id) });
  return { map: mapFor(root, id), jsonFile: "", htmlFile: "", knowledge };
};

describe("project build --all", () => {
  it("按依赖和优先级严格串行，并在单场景失败后保留结果且可恢复", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "code-doctor-run-all-"));
    directories.push(root);
    await fs.writeFile(path.join(root, "app.ts"), "export const app = true;\n", "utf8");
    await saveDiscoveredScenarios(root, [entry("root", "critical"), entry("child", "critical", ["root"]), entry("later", "normal")]);
    expect(orderProjectScenarios(await listScenarios(root)).map((item) => item.id)).toEqual(["root", "child", "later"]);
    const calls: string[] = [];
    let active = 0;
    let peak = 0;
    const buildMap = async (input: Parameters<typeof buildBusinessMap>[0]) => {
      const id = input.scenarioId!;
      calls.push(id);
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active -= 1;
      if (id === "child") throw new Error("缺少可读证据");
      const knowledge = await saveScenarioCandidate({ root, id, map: mapFor(root, id) });
      return { map: mapFor(root, id), jsonFile: "", htmlFile: "", knowledge };
    };

    const first = await runAllProjectScenarios({ root, config: DEFAULT_CONFIG }, { buildMap });

    expect(calls).toEqual(["root", "child", "later"]);
    expect(peak).toBe(1);
    expect(first.state.status).toBe("completed_with_failures");
    expect(first.state.scenarios).toEqual([
      expect.objectContaining({ id: "root", status: "completed", attempts: 1 }),
      expect.objectContaining({ id: "child", status: "failed", attempts: 1, error: "缺少可读证据" }),
      expect.objectContaining({ id: "later", status: "completed", attempts: 1 }),
    ]);
    expect(first.report.coverage).toMatchObject({ mapped: 2, buildFailed: 1, buildPending: 0 });
    expect(first.report.unknownBoundaries.join("\n")).toContain("建图失败");
    const resumedCalls: string[] = [];

    const resumed = await runAllProjectScenarios({ root, config: DEFAULT_CONFIG }, {
      buildMap: successfulMapBuilder(root, resumedCalls),
    });

    expect(resumedCalls).toEqual(["child"]);
    expect(resumed.state.status).toBe("completed");
    expect(resumed.state.scenarios).toEqual([
      expect.objectContaining({ id: "root", status: "completed", attempts: 1 }),
      expect.objectContaining({ id: "child", status: "completed", attempts: 2 }),
      expect.objectContaining({ id: "later", status: "completed", attempts: 1 }),
    ]);
    expect(resumed.report.coverage).toMatchObject({ mapped: 3, buildFailed: 0, buildPending: 0, mapPercent: 100 });
  });

  it("atlas 为空时先自动发现，并用 limit 留下可继续的 pending 状态", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "code-doctor-run-discover-"));
    directories.push(root);
    await fs.writeFile(path.join(root, "app.ts"), "export const app = true;\n", "utf8");
    let discovered = 0;
    const calls: string[] = [];

    const result = await runAllProjectScenarios({ root, config: DEFAULT_CONFIG, limit: 1 }, {
      discover: async () => {
        discovered += 1;
        const scenarios = [entry("first", "critical"), entry("second", "normal")];
        await saveDiscoveredScenarios(root, scenarios);
        return { projectSummary: "测试项目", scenarios, candidateFile: "" };
      },
      buildMap: successfulMapBuilder(root, calls),
    });

    expect(discovered).toBe(1);
    expect(calls).toEqual(["first"]);
    expect(result.state).toMatchObject({ status: "partial", discoveryPerformed: true });
    expect(result.state.scenarios).toEqual([
      expect.objectContaining({ id: "first", status: "completed" }),
      expect.objectContaining({ id: "second", status: "pending" }),
    ]);
    expect(result.report.coverage).toMatchObject({ buildPending: 1, buildFailed: 0 });
    expect(result.report.unknownBoundaries.join("\n")).toContain("仍待处理");
  });

  it("地图已保存但完成状态尚未落盘时不会重复调用 Agent", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "code-doctor-run-interrupted-"));
    directories.push(root);
    await fs.writeFile(path.join(root, "app.ts"), "export const app = true;\n", "utf8");
    await saveDiscoveredScenarios(root, [entry("interrupted", "critical")]);
    await saveScenarioCandidate({ root, id: "interrupted", map: mapFor(root, "interrupted") });
    const output = path.join(root, ".code-doctor", "output");
    await fs.mkdir(output, { recursive: true });
    await fs.writeFile(path.join(output, "project-build-run.json"), JSON.stringify({
      schemaVersion: 1,
      startedAt: "2026-07-19T00:00:00.000Z",
      updatedAt: "2026-07-19T00:00:01.000Z",
      status: "running",
      discoveryPerformed: false,
      scenarios: [{
        id: "interrupted",
        title: "场景 interrupted",
        focus: "理解场景 interrupted",
        status: "running",
        attempts: 1,
        startedAt: "2026-07-19T00:00:01.000Z",
      }],
    }), "utf8");
    const calls: string[] = [];

    const result = await runAllProjectScenarios({ root, config: DEFAULT_CONFIG }, {
      buildMap: successfulMapBuilder(root, calls),
    });

    expect(calls).toEqual([]);
    expect(result.state.scenarios[0]).toMatchObject({ status: "completed", attempts: 1 });
  });
});
