import type {
  ProjectAuditFinding,
  ProjectAuditReport,
  ProjectBusinessReport,
} from "../types.js";
import { stableId } from "../utils.js";

const categories = new Set<ProjectAuditFinding["category"]>([
  "unreachable_business_outcome", "condition_coverage", "state_transition",
  "cross_scenario_conflict", "missing_side_effect", "other_business_logic",
]);
const severities = new Set(["error", "warning", "info"]);
const statuses = new Set(["risk", "uncertain"]);
const object = (value: unknown, name: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} 必须是对象`);
  return value as Record<string, unknown>;
};
const string = (value: unknown, name: string): string => {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} 必须是非空字符串`);
  return value.trim();
};
const strings = (value: unknown, name: string): string[] => {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) throw new Error(`${name} 必须是字符串数组`);
  return [...new Set(value.map((item) => item.trim()).filter(Boolean))];
};

export const finalizeProjectAgentAudit = (input: {
  candidate: unknown;
  project: ProjectBusinessReport;
}): { findings: ProjectAuditFinding[]; conclusion: string; unansweredQuestions: string[] } => {
  const candidate = object(input.candidate, "项目业务审计候选");
  if (!Array.isArray(candidate.findings)) throw new Error("项目业务审计候选必须包含 findings 数组");
  const scenarios = new Map(input.project.scenarios.filter((scenario) => scenario.map).map((scenario) => [scenario.id, scenario]));
  const findings = candidate.findings.map((value, index): ProjectAuditFinding => {
    const item = object(value, `findings[${index}]`);
    const category = string(item.category, `findings[${index}].category`) as ProjectAuditFinding["category"];
    const severity = string(item.severity, `findings[${index}].severity`) as ProjectAuditFinding["severity"];
    let status = string(item.status, `findings[${index}].status`) as ProjectAuditFinding["status"];
    if (!categories.has(category)) throw new Error(`findings[${index}].category 不是允许的业务逻辑风险类别`);
    if (!severities.has(severity)) throw new Error(`findings[${index}].severity 无效`);
    if (!statuses.has(status)) throw new Error(`findings[${index}].status 无效`);
    const relatedScenarioIds = strings(item.relatedScenarioIds ?? [], `findings[${index}].relatedScenarioIds`).sort();
    if (!relatedScenarioIds.length) throw new Error(`findings[${index}] 至少引用一个业务场景`);
    for (const scenarioId of relatedScenarioIds) if (!scenarios.has(scenarioId)) throw new Error(`结论引用了不存在或尚未建图的业务场景：${scenarioId}`);

    if (!Array.isArray(item.relatedNodes)) throw new Error(`findings[${index}].relatedNodes 必须是数组`);
    const relatedNodes = item.relatedNodes.map((value, referenceIndex) => {
      const reference = object(value, `findings[${index}].relatedNodes[${referenceIndex}]`);
      const scenarioId = string(reference.scenarioId, `relatedNodes[${referenceIndex}].scenarioId`);
      const nodeId = string(reference.nodeId, `relatedNodes[${referenceIndex}].nodeId`);
      if (!relatedScenarioIds.includes(scenarioId)) throw new Error(`节点引用的场景未列入 relatedScenarioIds：${scenarioId}`);
      const scenario = scenarios.get(scenarioId);
      if (!scenario || !scenario.map?.nodes.some((node) => node.id === nodeId)) throw new Error(`结论引用了不存在的业务节点：${scenarioId}/${nodeId}`);
      return { scenarioId, nodeId };
    });
    if (!Array.isArray(item.evidence)) throw new Error(`findings[${index}].evidence 必须是数组`);
    const evidence = item.evidence.map((value, referenceIndex) => {
      const reference = object(value, `findings[${index}].evidence[${referenceIndex}]`);
      const scenarioId = string(reference.scenarioId, `evidence[${referenceIndex}].scenarioId`);
      const evidenceId = string(reference.evidenceId, `evidence[${referenceIndex}].evidenceId`);
      if (!relatedScenarioIds.includes(scenarioId)) throw new Error(`证据引用的场景未列入 relatedScenarioIds：${scenarioId}`);
      const scenario = scenarios.get(scenarioId);
      if (!scenario || !scenario.map?.evidence.some((entry) => entry.id === evidenceId)) throw new Error(`结论引用了不存在的业务证据：${scenarioId}/${evidenceId}`);
      return { scenarioId, evidenceId };
    });
    const confidence = Number(item.confidence);
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new Error(`findings[${index}].confidence 必须是 0 到 1`);
    const strongEvidence = evidence.some((reference) => {
      const entry = scenarios.get(reference.scenarioId)?.map?.evidence.find((candidate) => candidate.id === reference.evidenceId);
      return entry && ["source", "test", "runtime", "human"].includes(entry.kind);
    });
    let normalizedConfidence = confidence;
    // “已发现风险”必须同时落到业务节点和强证据；只有场景级猜测或随手引用一条
    // 源码证据都不足以证明风险，统一降级为待确认。
    if (!strongEvidence || !relatedNodes.length) {
      status = "uncertain";
      normalizedConfidence = Math.min(normalizedConfidence, 0.69);
    }
    const title = string(item.title, `findings[${index}].title`);
    const referenceKey = [
      ...relatedScenarioIds,
      ...relatedNodes.map((reference) => `${reference.scenarioId}/${reference.nodeId}`),
      ...evidence.map((reference) => `${reference.scenarioId}/${reference.evidenceId}`),
    ].sort();
    return {
      id: `agent-${stableId(category, title, ...referenceKey)}`,
      source: "agent",
      category,
      status,
      severity,
      title,
      conclusion: string(item.conclusion, `findings[${index}].conclusion`),
      reasoning: strings(item.reasoning ?? [], `findings[${index}].reasoning`),
      relatedScenarioIds,
      relatedNodes,
      evidence,
      confidence: normalizedConfidence,
      recommendation: typeof item.recommendation === "string" && item.recommendation.trim() ? item.recommendation.trim() : undefined,
    };
  });
  const unique = new Map(findings.map((finding) => [finding.id, finding]));
  return {
    findings: [...unique.values()],
    conclusion: string(candidate.conclusion, "conclusion"),
    unansweredQuestions: strings(candidate.unansweredQuestions ?? [], "unansweredQuestions"),
  };
};

export const summarizeProjectAudit = (report: Omit<ProjectAuditReport, "summary">): ProjectAuditReport["summary"] => ({
  risk: report.findings.filter((finding) => finding.status === "risk").length,
  uncertain: report.findings.filter((finding) => finding.status === "uncertain").length,
  error: report.findings.filter((finding) => finding.severity === "error").length,
  warning: report.findings.filter((finding) => finding.severity === "warning").length,
  structure: report.findings.filter((finding) => finding.source === "structure").length,
  agent: report.findings.filter((finding) => finding.source === "agent").length,
});
