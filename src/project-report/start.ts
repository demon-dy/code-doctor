import { initializeProject } from "../init.js";
import { analyzeCodeGraph } from "../graph/analyze.js";
import { writeGraphArtifacts } from "../graph/render.js";
import { auditProjectBusiness } from "../project-audit/audit.js";
import type { CodeDoctorConfig, ProjectAuditReport, ProjectBusinessReport } from "../types.js";
import { buildProjectReport } from "./build.js";
import { inspectProject, type ProjectDoctorReport } from "./doctor.js";
import { runAllProjectScenarios } from "./run-all.js";

export interface ProjectStartResult {
  status: "completed" | "partial" | "degraded";
  initializedFiles: string[];
  doctor: ProjectDoctorReport;
  attempted: number;
  completed: number;
  failed: number;
  audit?: ProjectAuditReport;
  report: ProjectBusinessReport;
  htmlFile: string;
  messages: string[];
}

export const startProject = async (input: {
  root: string;
  config: CodeDoctorConfig;
  limit?: number;
  audit?: boolean;
}): Promise<ProjectStartResult> => {
  if (input.limit !== undefined && (!Number.isInteger(input.limit) || input.limit < 1)) {
    throw new Error("--limit 必须是大于 0 的整数");
  }
  const initializedFiles = await initializeProject(input.root);
  const doctor = await inspectProject(input.root, input.config);
  const messages: string[] = [];
  let attempted = 0;
  let completed = doctor.knowledge.mapped;
  let failed = 0;

  if (!doctor.languages.length) {
    messages.push("未检测到支持的业务源码；已生成覆盖边界报告，没有调用 Agent。");
    const graph = await analyzeCodeGraph({ root: input.root, config: input.config });
    await writeGraphArtifacts(input.root, graph);
  } else if (!doctor.agent.available) {
    messages.push("没有可用 Agent；已生成技术图和覆盖边界。配置 Agent 后再次执行会从现有知识继续。");
    const graph = await analyzeCodeGraph({ root: input.root, config: input.config });
    await writeGraphArtifacts(input.root, graph);
  } else if (!input.config.businessMap.enabled) {
    messages.push("businessMap.enabled=false；已生成技术图和覆盖边界，没有调用 Agent。启用后可继续业务发现与建图。");
    const graph = await analyzeCodeGraph({ root: input.root, config: input.config });
    await writeGraphArtifacts(input.root, graph);
  } else {
    const build = await runAllProjectScenarios({ root: input.root, config: input.config, limit: input.limit ?? 1 });
    attempted = build.attempted;
    completed = build.completed;
    failed = build.failed;
    if (build.state.status === "partial") messages.push("仍有未建图场景；重复执行相同命令会继续，不会覆盖已有知识。");
    if (failed) messages.push(`${failed} 个场景本次失败；其他场景和报告已保留，下次会重试。`);
  }

  let audit: ProjectAuditReport | undefined;
  if (input.audit !== false) {
    const audited = await auditProjectBusiness({ root: input.root, config: input.config, useAgent: doctor.agent.available && completed > 0 });
    audit = audited.audit;
  }
  const final = await buildProjectReport(input.root);
  const degraded = !doctor.languages.length || !doctor.agent.available || !input.config.businessMap.enabled;
  return {
    status: degraded ? "degraded" : failed || completed < final.report.coverage.discovered ? "partial" : "completed",
    initializedFiles,
    doctor,
    attempted,
    completed,
    failed,
    audit,
    report: final.report,
    htmlFile: final.htmlFile,
    messages,
  };
};
