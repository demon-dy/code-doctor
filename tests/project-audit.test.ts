import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import YAML from "yaml";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/defaults.js";
import { initializeKnowledge } from "../src/knowledge.js";
import { auditProjectBusiness } from "../src/project-audit/audit.js";
import type { BusinessMap, CodeDoctorConfig } from "../src/types.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

const businessMap = (): BusinessMap => ({
  schemaVersion: 1,
  createdAt: "2026-07-19T01:00:00.000Z",
  root: ".",
  title: "会员弹窗决策",
  focus: "会员状态决定弹窗",
  summary: "根据会员状态选择弹窗",
  chapters: [{ id: "main", title: "弹窗决策", summary: "检查状态并展示", nodeIds: ["decision.vip", "outcome.renew", "action.welcome", "state.orphan"] }],
  nodes: [
    { id: "decision.vip", label: "会员是否过期", kind: "decision", summary: "检查会员状态", status: "fact", evidenceIds: ["src.popup"] },
    { id: "outcome.renew", label: "续费弹窗", kind: "outcome", summary: "展示续费弹窗", status: "fact", evidenceIds: ["src.popup"] },
    { id: "action.welcome", label: "准备欢迎弹窗", kind: "action", summary: "准备但没有展示结果", status: "fact", evidenceIds: ["src.popup"] },
    { id: "state.orphan", label: "孤立状态", kind: "state", summary: "没有上下游", status: "unknown", evidenceIds: [] },
  ],
  edges: [
    { id: "edge.renew", from: "decision.vip", to: "outcome.renew", guard: "expired=true", status: "fact", confidence: 1, evidenceIds: ["src.popup"] },
    { id: "edge.welcome", from: "decision.vip", to: "action.welcome", guard: "expired=true", status: "inference", confidence: 0.7, evidenceIds: ["src.popup"] },
  ],
  evidence: [{ id: "src.popup", kind: "source", description: "会员过期判断", location: { file: "app.ts", line: 1 }, confidence: 1 }],
  uncertainties: [],
});

const setup = async (): Promise<string> => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "code-doctor-project-audit-"));
  directories.push(root);
  await fs.writeFile(path.join(root, "app.ts"), "export const popup = (expired: boolean) => expired ? 'renew' : 'welcome';\n", "utf8");
  await initializeKnowledge(root);
  const knowledge = path.join(root, ".code-doctor", "knowledge");
  await fs.writeFile(path.join(knowledge, "atlas.yaml"), YAML.stringify({
    schemaVersion: 1,
    scenarios: [
      { id: "popup", title: "会员弹窗", focus: "会员状态决定弹窗", status: "candidate", updatedAt: "2026-07-19T01:00:00.000Z", evidenceFiles: ["app.ts"] },
      { id: "payment", title: "支付", focus: "支付成功", status: "candidate", updatedAt: "2026-07-19T01:00:00.000Z" },
    ],
  }), "utf8");
  await fs.writeFile(path.join(knowledge, "scenarios", "popup.candidate.json"), JSON.stringify({
    schemaVersion: 1, id: "popup", title: "会员弹窗", focus: "会员状态决定弹窗", status: "candidate",
    createdAt: "2026-07-19T01:00:00.000Z", updatedAt: "2026-07-19T01:00:00.000Z", map: businessMap(),
  }), "utf8");
  return root;
};

describe("project business risk audit", () => {
  it("无 Agent 时仍检测断链、分支和证据结构风险，并聚合到唯一 HTML", async () => {
    const root = await setup();
    const result = await auditProjectBusiness({ root, config: DEFAULT_CONFIG, useAgent: false });

    expect(result.audit.agent.status).toBe("skipped");
    expect(result.audit.mappedScenarioCount).toBe(1);
    expect(result.audit.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: "structure", category: "dead_end", status: "uncertain" }),
      expect.objectContaining({ source: "structure", category: "guard_conflict", status: "uncertain" }),
      expect.objectContaining({ source: "structure", category: "unreachable", status: "uncertain" }),
      expect.objectContaining({ source: "structure", category: "evidence_gap", status: "uncertain" }),
    ]));
    expect(new Set(result.audit.findings.map((finding) => finding.id)).size).toBe(result.audit.findings.length);
    expect(result.audit.boundaries.join("\n")).toContain("尚未建图");
    const projectReport = JSON.parse(await fs.readFile(result.reportFile, "utf8")) as { audit?: { findings: unknown[] } };
    expect(projectReport.audit?.findings.length).toBe(result.audit.findings.length);
    const html = await fs.readFile(result.htmlFile, "utf8");
    expect(html).toContain("优先复核的业务链风险");
    expect(html).toContain("AI 业务审计");
    expect(html).toContain("本场景风险与需复核项");
    expect(() => new vm.Script(html.match(/<script>([\s\S]*)<\/script>/)?.[1] ?? "")).not.toThrow();
  });

  it("严格校验 AI 候选引用，并保留有源码证据的跨场景业务风险", async () => {
    const root = await setup();
    await fs.writeFile(path.join(root, "agent.mjs"), `import fs from 'node:fs';
const task=JSON.parse(fs.readFileSync('.code-doctor/project-audit-task.json','utf8'));
fs.writeFileSync(task.candidateFile,JSON.stringify({conclusion:'欢迎弹窗路径可能不可达。',findings:[{category:'unreachable_business_outcome',status:'risk',severity:'error',title:'欢迎弹窗没有展示结果',conclusion:'过期条件同时流向两个分支，欢迎分支只停留在准备动作。',reasoning:['两个分支 guard 相同','欢迎动作没有 outcome'],relatedScenarioIds:['popup'],relatedNodes:[{scenarioId:'popup',nodeId:'decision.vip'},{scenarioId:'popup',nodeId:'action.welcome'}],evidence:[{scenarioId:'popup',evidenceId:'src.popup'}],confidence:.93,recommendation:'修正互斥条件并补充欢迎弹窗结果测试'},{category:'state_transition',status:'risk',severity:'warning',title:'取消状态可能遗漏',conclusion:'没有证据证明取消路径。',reasoning:['地图未出现取消状态'],relatedScenarioIds:['popup'],relatedNodes:[],evidence:[{scenarioId:'popup',evidenceId:'src.popup'}],confidence:.95}],unansweredQuestions:['普通会员是否必须展示欢迎弹窗？']}));`, "utf8");
    const config: CodeDoctorConfig = { ...DEFAULT_CONFIG, agent: { provider: "custom", command: "node agent.mjs {promptFile}" } };

    const result = await auditProjectBusiness({ root, config });

    expect(result.audit.agent).toMatchObject({ status: "completed", provider: "custom", conclusion: "欢迎弹窗路径可能不可达。" });
    expect(result.audit.findings).toContainEqual(expect.objectContaining({
      source: "agent", category: "unreachable_business_outcome", status: "risk", severity: "error", confidence: 0.93,
      evidence: [{ scenarioId: "popup", evidenceId: "src.popup" }],
    }));
    expect(result.audit.findings).toContainEqual(expect.objectContaining({
      source: "agent", category: "state_transition", status: "uncertain", confidence: 0.69,
      evidence: [{ scenarioId: "popup", evidenceId: "src.popup" }],
    }));
    expect(result.audit.boundaries.join("\n")).toContain("普通会员是否必须展示欢迎弹窗");
    await expect(fs.access(path.join(root, ".code-doctor", "output", "project-audit.candidate.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("Agent 引用不存在的节点时降级为失败，但确定性结果和报告仍然落盘", async () => {
    const root = await setup();
    await fs.writeFile(path.join(root, "agent.mjs"), `import fs from 'node:fs';
const task=JSON.parse(fs.readFileSync('.code-doctor/project-audit-task.json','utf8'));
fs.writeFileSync(task.candidateFile,JSON.stringify({conclusion:'错误候选',findings:[{category:'condition_coverage',status:'risk',severity:'error',title:'错误引用',conclusion:'无法验证',reasoning:[],relatedScenarioIds:['popup'],relatedNodes:[{scenarioId:'popup',nodeId:'missing.node'}],evidence:[],confidence:1}],unansweredQuestions:[]}));`, "utf8");
    const config: CodeDoctorConfig = { ...DEFAULT_CONFIG, agent: { provider: "custom", command: "node agent.mjs {promptFile}" } };

    const result = await auditProjectBusiness({ root, config });

    expect(result.audit.agent.status).toBe("failed");
    expect(result.audit.agent.error).toContain("不存在的业务节点");
    expect(result.audit.findings.length).toBeGreaterThan(0);
    expect(result.audit.findings.every((finding) => finding.source === "structure")).toBe(true);
    await expect(fs.access(result.auditFile)).resolves.toBeUndefined();
    await expect(fs.access(result.htmlFile)).resolves.toBeUndefined();
    await expect(fs.access(path.join(root, ".code-doctor", "output", "project-audit-agent-stdout.jsonl"))).resolves.toBeUndefined();
  });
});
