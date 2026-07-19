import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import YAML from "yaml";
import { afterEach, describe, expect, it } from "vitest";
import { initializeKnowledge } from "../src/knowledge.js";
import { buildProjectReport } from "../src/project-report/build.js";
import type { BusinessMap } from "../src/types.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

const map = (root: string): BusinessMap => ({
  schemaVersion: 1,
  createdAt: "2026-07-19T00:00:00.000Z",
  root,
  title: "登录与会员状态",
  focus: "登录后刷新会员权益",
  summary: "用户登录后同步会员状态并决定首页权益",
  chapters: [{ id: "chapter-login", title: "登录", summary: "完成登录并读取权益", nodeIds: ["login", "vip"] }],
  nodes: [
    { id: "login", label: "登录成功", kind: "scenario", summary: "取得用户身份", status: "fact", evidenceIds: ["source-login"] },
    { id: "vip", label: "刷新会员权益", kind: "outcome", summary: "更新首页会员状态", status: "unknown", evidenceIds: ["source-login"] },
  ],
  edges: [{ id: "login-vip", from: "login", to: "vip", guard: "登录态有效", status: "inference", confidence: 0.8, evidenceIds: ["source-login"] }],
  evidence: [{ id: "source-login", kind: "source", description: "登录成功后刷新会员", location: { file: "src/login.ts", line: 1 }, confidence: 1 }],
  uncertainties: ["会员接口失败后的降级结果尚未确认"],
});

describe("project business report", () => {
  it("聚合新旧知识目录并生成可下钻的单文件项目总览", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "code-doctor-project-"));
    directories.push(root);
    await fs.mkdir(path.join(root, "src"));
    await fs.writeFile(path.join(root, "src", "login.ts"), "export const login = true;\n", "utf8");
    await initializeKnowledge(root);
    const knowledge = path.join(root, ".code-doctor", "knowledge");
    await fs.writeFile(path.join(knowledge, "project.candidate.yaml"), YAML.stringify({ schemaVersion: 1, summary: "一个会员权益应用" }), "utf8");
    await fs.writeFile(path.join(knowledge, "atlas.yaml"), YAML.stringify({
      schemaVersion: 1,
      updatedAt: "2026-07-19T00:00:00.000Z",
      scenarios: [
        { id: "login-vip", title: "登录与会员", focus: "登录后刷新会员", summary: "登录后决定权益", priority: "critical", dependsOn: [], evidenceFiles: ["src/login.ts"], status: "candidate", updatedAt: "2026-07-19T00:00:00.000Z", candidateAvailable: true },
        { id: "payment", title: "会员支付", focus: "支付与权益生效", priority: "high", dependsOn: ["login-vip"], evidenceFiles: ["src/payment.ts"], status: "candidate", updatedAt: "2026-07-19T00:00:00.000Z" },
      ],
    }), "utf8");
    // 早期知识目录没有 KnowledgeScenarioRecord 包装，直接保存 BusinessMap。
    await fs.writeFile(path.join(knowledge, "scenarios", "login-vip.candidate.json"), JSON.stringify(map(root)), "utf8");
    const { chapters: _chapters, ...veryOldMap } = map(root);
    await fs.writeFile(path.join(knowledge, "scenarios", "orphan.json"), JSON.stringify({ ...veryOldMap, title: "未进入目录的历史场景", focus: "历史场景" }), "utf8");

    const result = await buildProjectReport(root);

    expect(result.report.project).toMatchObject({ summary: "一个会员权益应用", summaryStatus: "candidate" });
    expect(result.report.coverage).toMatchObject({ discovered: 3, mapped: 2, reviewed: 1, mapPercent: 67 });
    expect(result.report.scenarios[0]).toMatchObject({ id: "login-vip", state: "mapped", priority: "critical" });
    expect(result.report.scenarios[1]).toMatchObject({ id: "payment", state: "unmapped", missingEvidenceFiles: ["src/payment.ts"] });
    expect(result.report.scenarios[2]).toMatchObject({ id: "orphan", state: "reviewed", map: { chapters: [expect.objectContaining({ id: "legacy-overview" })] } });
    expect(result.report.unknownBoundaries.join("\n")).toContain("尚未建图");
    expect(result.report.unknownBoundaries.join("\n")).toContain("未知或证据冲突节点");
    const html = await fs.readFile(result.htmlFile, "utf8");
    expect(html).toContain("项目业务审计总览");
    expect(html).toContain("业务场景目录");
    expect(html).toContain("登录与会员");
    expect(html).toContain('class="project-sidebar"');
    expect(html).toContain('id="scenario-nav"');
    expect(html).toContain("项目总览");
    expect(html).toContain("沿业务场景理解主链");
    expect(html).not.toContain('class="workspace-nav"');
    expect(html).not.toContain("返回项目业务全景");
    expect(html).toContain("执行路径");
    expect(html).toContain("可视化执行链");
    expect(html).toContain("window.__CODE_DOCTOR_EMBEDDED__=true");
    expect(html).toContain("当前场景可视化执行链");
    expect(html).toContain("条件列表");
    expect(html).toContain("attachShadow({mode:'open'})");
    expect(html).toContain("window.__CODE_DOCTOR_MAP_HOST__");
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain("sandbox','allow-scripts");
    expect(html).toContain("默认折叠，需要时逐章展开");
    expect(html).toContain("点击风险会直接进入所属业务场景");
    expect(html).toContain("renderScenarioNav()");
    expect(html).toContain('actor:"角色"');
    expect(html).toContain('fact:"代码事实"');
    expect(html).toContain('critical:"关键业务"');
    expect(html).toContain('source:"源码"');
    expect(html).toContain("uiLabel(kindLabels,n.kind)");
    expect(html).toContain("uiLabel(statusLabels,n.status)");
    expect(html).not.toContain("esc(n.kind)+' · '+esc(n.status)");
    expect(html).toContain('data-scenario-pane="evidence"');
    expect(html).not.toContain("detail-layout");
    expect(html).toContain("会员接口失败后的降级结果尚未确认");
    expect(() => new vm.Script(html.match(/<script>([\s\S]*)<\/script>/)?.[1] ?? "")).not.toThrow();
    await expect(fs.access(result.jsonFile)).resolves.toBeUndefined();
  });

  it("不会把知识文件中的 sourceCommit 当作 shell 命令执行", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "code-doctor-project-safe-"));
    directories.push(root);
    await fs.mkdir(path.join(root, "src"));
    await fs.writeFile(path.join(root, "src", "login.ts"), "export const login = true;\n", "utf8");
    await initializeKnowledge(root);
    const knowledge = path.join(root, ".code-doctor", "knowledge");
    await fs.writeFile(path.join(knowledge, "atlas.yaml"), YAML.stringify({
      schemaVersion: 1,
      scenarios: [{ id: "login-vip", title: "登录与会员", focus: "登录后刷新会员", evidenceFiles: ["src/login.ts"] }],
    }), "utf8");
    const marker = path.join(root, "should-not-exist");
    await fs.writeFile(path.join(knowledge, "scenarios", "login-vip.candidate.json"), JSON.stringify({
      schemaVersion: 1,
      updatedAt: "2026-07-19T00:00:00.000Z",
      sourceCommit: `$(touch ${marker})`,
      map: map(root),
    }), "utf8");

    const result = await buildProjectReport(root);

    expect(result.report.scenarios[0]?.freshness).toBe("unknown");
    await expect(fs.access(marker)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("忽略结构损坏的批量运行状态并仍可生成项目报告", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "code-doctor-project-broken-state-"));
    directories.push(root);
    await initializeKnowledge(root);
    const output = path.join(root, ".code-doctor", "output");
    await fs.mkdir(output, { recursive: true });
    await fs.writeFile(path.join(output, "project-build-run.json"), JSON.stringify({ schemaVersion: 1, scenarios: null }), "utf8");

    const result = await buildProjectReport(root);

    expect(result.report.coverage).toMatchObject({ discovered: 0, buildPending: 0, buildFailed: 0 });
    await expect(fs.access(result.htmlFile)).resolves.toBeUndefined();
  });

  it("地图更新后不会把旧增量分析边界混入当前结论", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "code-doctor-project-stale-impact-"));
    directories.push(root);
    await fs.mkdir(path.join(root, "src"));
    await fs.writeFile(path.join(root, "src", "login.ts"), "export const login = true;\n", "utf8");
    await initializeKnowledge(root);
    const knowledge = path.join(root, ".code-doctor", "knowledge");
    await fs.writeFile(path.join(knowledge, "atlas.yaml"), YAML.stringify({
      schemaVersion: 1,
      scenarios: [{ id: "login-vip", title: "登录与会员", focus: "登录后刷新会员", evidenceFiles: ["src/login.ts"] }],
    }), "utf8");
    await fs.writeFile(path.join(knowledge, "scenarios", "login-vip.candidate.json"), JSON.stringify({
      schemaVersion: 1,
      updatedAt: "2026-07-19T02:00:00.000Z",
      map: { ...map(root), createdAt: "2026-07-19T02:00:00.000Z" },
    }), "utf8");
    const output = path.join(root, ".code-doctor", "output");
    await fs.mkdir(output, { recursive: true });
    await fs.writeFile(path.join(output, "project-impact.json"), JSON.stringify({
      schemaVersion: 1,
      createdAt: "2026-07-19T01:00:00.000Z",
      updatedAt: "2026-07-19T01:00:00.000Z",
      root,
      range: "HEAD~1...HEAD",
      status: "completed",
      useAgent: true,
      changedFiles: [],
      impactedScenarios: [],
      unchangedScenarioIds: ["login-vip"],
      unattributedFiles: [],
      unknownBoundaries: ["1 个已发现业务场景尚未建图。"],
      audit: { status: "completed" },
    }), "utf8");

    const result = await buildProjectReport(root);

    expect(result.report.impact).toBeDefined();
    expect(result.report.unknownBoundaries).not.toContain("1 个已发现业务场景尚未建图。");
    expect(result.report.unknownBoundaries.join("\n")).toContain("旧分析边界未并入当前结论");
    expect(await fs.readFile(result.htmlFile, "utf8")).toContain("历史 Git 变更影响（需更新）");
  });
});
