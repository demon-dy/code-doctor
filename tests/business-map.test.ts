import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { afterEach, describe, expect, it } from "vitest";
import { buildBusinessMap } from "../src/business-map/build.js";
import { checkBusinessRequirement } from "../src/business-map/check.js";
import { discoverBusinessScenarios } from "../src/business-map/discover.js";
import { finalizeBusinessMap } from "../src/business-map/schema.js";
import { DEFAULT_CONFIG } from "../src/defaults.js";
import {
  confirmScenario,
  confirmTakeoverScenario,
  listScenarios,
  nextTakeoverScenario,
  startTakeover,
  takeoverProgress,
} from "../src/knowledge.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe("AI business map", () => {
  it("通过通用 Agent 生成可追溯业务地图并检查自然语言需求", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "code-doctor-business-"));
    directories.push(root);
    await fs.writeFile(path.join(root, "app.ts"), `export const showPopup = (expired: boolean) => expired ? "renew" : "welcome";\n`, "utf8");
    await fs.writeFile(
      path.join(root, "agent.mjs"),
      `import fs from 'node:fs';
const prompt = fs.readFileSync(process.argv[2], 'utf8');
if (prompt.includes('discover-task.json')) {
  const task = JSON.parse(fs.readFileSync('.code-doctor/discover-task.json', 'utf8'));
  fs.writeFileSync(task.candidateFile, JSON.stringify({
    projectSummary: '一个根据会员状态选择弹窗的应用',
    scenarios: [{ id: 'home-popup', title: '首页弹窗', focus: '首页弹窗选择与展示条件', summary: '用户进入首页后按会员状态展示弹窗', priority: 'critical', dependsOn: [], evidenceFiles: ['app.ts'] }]
  }));
} else if (prompt.includes('map-task.json')) {
  const task = JSON.parse(fs.readFileSync('.code-doctor/map-task.json', 'utf8'));
  fs.writeFileSync(task.candidateFile, JSON.stringify({
    title: '弹窗业务', summary: '根据会员到期状态选择弹窗',
    nodes: [
      { id: 'scenario.popup', label: '进入首页', kind: 'scenario', summary: '用户进入首页后检查弹窗', status: 'inference', evidenceIds: ['src.popup'] },
      { id: 'decision.expired', label: '会员是否到期', kind: 'decision', summary: '根据 expired 决定结果', status: 'fact', evidenceIds: ['src.popup'] },
      { id: 'outcome.renew', label: '续费弹窗', kind: 'outcome', summary: '展示续费提醒', status: 'fact', evidenceIds: ['src.popup'] }
    ],
    edges: [
      { id: 'edge.1', from: 'scenario.popup', to: 'decision.expired', status: 'inference', confidence: 0.7, evidenceIds: ['src.popup'] },
      { id: 'edge.2', from: 'decision.expired', to: 'outcome.renew', guard: 'expired === true', status: 'fact', confidence: 1, evidenceIds: ['src.popup'] }
    ],
    evidence: [{ id: 'src.popup', kind: 'source', description: '弹窗条件', location: { file: 'app.ts', line: 1 }, confidence: 1 }],
    uncertainties: ['welcome 是否为新用户弹窗需要人工确认']
  }));
} else {
  const task = JSON.parse(fs.readFileSync('.code-doctor/check-task.json', 'utf8'));
  fs.writeFileSync(task.candidateFile, JSON.stringify({
    expectation: { interpretation: '到期会员应看到续费弹窗', actors: ['到期会员'], preconditions: ['expired=true'], expectedOutcomes: ['续费弹窗'], assumptions: [] },
    conclusion: '当前实现满足续费弹窗需求。',
    findings: [{ id: 'finding.renew', status: 'satisfied', severity: 'info', title: '续费弹窗可达', conclusion: 'expired 为 true 时返回 renew。', reasoning: ['决策边明确存在'], relatedNodeIds: ['decision.expired', 'outcome.renew'], evidenceIds: ['src.popup'], confidence: 0.98 }],
    unansweredQuestions: []
  }));
}
`,
      "utf8",
    );
    const config = {
      ...DEFAULT_CONFIG,
      agent: { provider: "custom" as const, command: "node agent.mjs {promptFile}" },
      graph: { ...DEFAULT_CONFIG.graph, include: ["**/*.ts"] },
    };

    const discovered = await discoverBusinessScenarios({ root, config });
    expect(discovered.scenarios).toEqual([expect.objectContaining({ id: "home-popup", priority: "critical", status: "candidate" })]);
    expect(await fs.readFile(path.join(root, ".code-doctor", "knowledge", "project.candidate.yaml"), "utf8")).toContain("一个根据会员状态选择弹窗的应用");
    const built = await buildBusinessMap({ root, config, focus: "首页弹窗", scenarioId: "home-popup" });
    expect(built.map.nodes).toHaveLength(3);
    expect(built.map.evidence[0]?.location).toEqual({ file: "app.ts", line: 1, column: undefined });
    const mapHtml = await fs.readFile(built.htmlFile, "utf8");
    expect(mapHtml).toContain("AI 业务地图");
    expect(mapHtml).toContain("code-doctor-map-root");
    expect(mapHtml).toContain("react-flow");
    expect(mapHtml).toContain("legend-panel");
    expect(mapHtml).toContain("kind-decision");
    expect(mapHtml).toContain("panOnScroll");
    expect(mapHtml).toContain("zoomOnPinch");
    expect(mapHtml).toContain("edge-label");
    expect(() => new vm.Script(mapHtml.match(/<script>([\s\S]*)<\/script>/)?.[1] ?? "")).not.toThrow();
    expect(built.knowledge?.id).toBe("home-popup");
    expect((await listScenarios(root))[0]).toMatchObject({ id: "home-popup", status: "candidate", candidateAvailable: true });
    const reviewed = await confirmScenario({ root, id: "home-popup", reviewer: "owner-a" });
    expect(reviewed).toMatchObject({ status: "reviewed", reviewedBy: "owner-a" });
    await startTakeover(root, "new-owner");
    expect(await nextTakeoverScenario(root)).toMatchObject({ id: "home-popup", status: "in_progress" });
    await confirmTakeoverScenario({ root, id: "home-popup", owner: "new-owner" });
    expect(await takeoverProgress(root)).toMatchObject({ total: 1, understood: 1, percent: 100 });

    const checked = await checkBusinessRequirement({ root, config, requirement: "到期会员必须看到续费弹窗" });
    expect(checked.report.findings[0]).toMatchObject({ status: "satisfied", confidence: 0.98 });
    expect(checked.report.expectation.raw).toBe("到期会员必须看到续费弹窗");
    const reportHtml = await fs.readFile(checked.htmlFile, "utf8");
    expect(reportHtml).toContain("AI 业务审计报告");
    expect(() => new vm.Script(reportHtml.match(/<script>([\s\S]*)<\/script>/)?.[1] ?? "")).not.toThrow();
  });

  it("拒绝 Agent 把没有人工证据的推断标记为人工确认", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "code-doctor-trust-"));
    directories.push(root);
    await fs.writeFile(path.join(root, "app.ts"), "export const enabled = true;\n", "utf8");
    await expect(finalizeBusinessMap({
      root,
      focus: "开关",
      config: DEFAULT_CONFIG.businessMap,
      agent: { provider: "custom", command: "test", exitCode: 0, durationMs: 1, stdout: "", stderr: "" },
      candidate: {
        title: "开关", summary: "开关场景",
        nodes: [{ id: "decision.enabled", label: "是否开启", kind: "decision", summary: "读取开关", status: "confirmed", evidenceIds: ["src.enabled"] }],
        edges: [],
        evidence: [{ id: "src.enabled", kind: "source", description: "开关源码", location: { file: "app.ts", line: 1 }, confidence: 1 }],
        uncertainties: [],
      },
    })).rejects.toThrow("必须引用 human 证据");
  });
});
