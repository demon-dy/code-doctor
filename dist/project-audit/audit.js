import fs from "node:fs/promises";
import path from "node:path";
import { runConfiguredAgent } from "../agent.js";
import { assertBusinessSourceUnchanged, captureBusinessSourceState } from "../business-map/worktree.js";
import { ensureOutputDirectory, stableId, writeJson } from "../utils.js";
import { buildProjectReport } from "../project-report/build.js";
import { finalizeProjectAgentAudit, summarizeProjectAudit } from "./schema.js";
import { findStructuralRisks } from "./structure.js";
const projectAuditPrompt = (taskFile) => `你是 Code Doctor 的全项目业务逻辑审计 Agent。读取任务文件：${taskFile}

这不是语法、格式或通用代码质量检查。你的目标是从所有已建图业务场景及其源码证据中寻找：
1. 业务结果（页面、弹窗、通知、权益、失败/降级结果）是否实际上不可达；
2. 条件分支是否有覆盖缺口、重叠、互斥错误或错误优先级；
3. 状态转换是否遗漏进入、退出、重试、取消或异常路径；
4. 不同场景对同一业务规则的实现是否矛盾；
5. 必需副作用是否遗漏、重复或发生顺序错误。

硬性约束：
- 先读 projectReportFile 中的 coverage、unknownBoundaries 和全部已建图场景；必要时继续读取引用的源码和测试。
- 只报告业务逻辑风险，不报告命名、格式、类型、lint 或一般重构建议。
- 每条 finding 必须引用现有 relatedScenarioIds，并使用 {scenarioId,nodeId}、{scenarioId,evidenceId} 精确引用现有节点和证据。
- risk 结论必须有 source、test、runtime 或 human 证据；没有足够反证时必须标 uncertain。
- 场景未建图、地图 stale、证据缺失属于审计边界，不得臆测为“安全”或“存在漏洞”。
- 不修改任何项目源码、知识目录或地图，只把 JSON 写入 candidateFile。
- 输出必须满足任务中的 outputContract，不要只在终端打印 JSON。`;
const missingFileFinding = (scenario) => {
    if (!scenario.map || !scenario.missingEvidenceFiles.length)
        return undefined;
    const missing = new Set(scenario.missingEvidenceFiles);
    const evidence = scenario.map.evidence
        .filter((item) => item.location?.file && missing.has(item.location.file))
        .map((item) => ({ scenarioId: scenario.id, evidenceId: item.id }));
    return {
        id: `structure-${stableId(scenario.id, "missing-evidence-files", ...scenario.missingEvidenceFiles)}`,
        source: "structure",
        category: "evidence_gap",
        status: "uncertain",
        severity: "warning",
        title: "需复核：证据文件在当前项目中不存在",
        conclusion: `场景“${scenario.title}”引用的 ${scenario.missingEvidenceFiles.length} 个证据文件无法读取，相关结论不能复核。`,
        reasoning: scenario.missingEvidenceFiles.map((file) => `缺失文件：${file}`),
        relatedScenarioIds: [scenario.id],
        relatedNodes: [],
        evidence,
        confidence: 1,
        recommendation: "确认文件是否被移动、删除或未包含在当前分支；重新建图前不要把相关结论视为事实。",
    };
};
export const auditProjectBusiness = async (input) => {
    const output = await ensureOutputDirectory(input.root);
    const initial = await buildProjectReport(input.root);
    const project = initial.report;
    const mapped = project.scenarios.filter((scenario) => scenario.map);
    const structural = mapped.flatMap(findStructuralRisks);
    for (const scenario of mapped) {
        const missing = missingFileFinding(scenario);
        if (missing)
            structural.push(missing);
    }
    const boundaries = [...project.unknownBoundaries];
    if (mapped.length < project.scenarios.length)
        boundaries.push(`${project.scenarios.length - mapped.length} 个候选场景尚未建图，AI 和结构审计均无法覆盖其内部业务逻辑。`);
    const stale = mapped.filter((scenario) => scenario.freshness === "stale");
    if (stale.length)
        boundaries.push(`${stale.length} 个场景地图已过期，本次风险结论可能遗漏最新代码变化。`);
    if (!mapped.length)
        boundaries.push("没有已建图场景；本次只能记录覆盖边界，不能判断业务链是否完整。");
    const base = {
        schemaVersion: 1,
        createdAt: new Date().toISOString(),
        root: input.root,
        sourceCommit: project.sourceCommit,
        mappedScenarioCount: mapped.length,
        discoveredScenarioCount: project.scenarios.length,
        auditedScenarios: mapped.map((scenario) => ({ id: scenario.id, mapCreatedAt: scenario.map.createdAt, freshness: scenario.freshness })),
        findings: structural,
        agent: { status: input.useAgent === false ? "skipped" : "failed" },
        boundaries,
    };
    if (input.useAgent === false)
        base.boundaries.push("本次使用 --no-agent，仅完成确定性结构审计；不可达结果、条件覆盖和跨场景矛盾等业务语义风险尚未由 AI 复核。");
    else if (mapped.length) {
        const candidateFile = path.join(output, "project-audit.candidate.json");
        const inputFile = path.join(output, "project-audit-input.json");
        const taskFile = path.join(input.root, ".code-doctor", "project-audit-task.json");
        const promptFile = path.join(input.root, ".code-doctor", "project-audit-prompt.md");
        await fs.rm(candidateFile, { force: true });
        const { audit: _previousAudit, ...projectInput } = project;
        await writeJson(inputFile, projectInput);
        await writeJson(taskFile, {
            schemaVersion: 1,
            kind: "project-business-logic-audit",
            root: input.root,
            projectReportFile: inputFile,
            candidateFile,
            auditBoundaries: base.boundaries,
            outputContract: {
                conclusion: "string",
                findings: [{
                        category: "unreachable_business_outcome|condition_coverage|state_transition|cross_scenario_conflict|missing_side_effect|other_business_logic",
                        status: "risk|uncertain",
                        severity: "error|warning|info",
                        title: "string",
                        conclusion: "string",
                        reasoning: ["string"],
                        relatedScenarioIds: ["existing mapped scenario id"],
                        relatedNodes: [{ scenarioId: "existing mapped scenario id", nodeId: "existing node id in that scenario" }],
                        evidence: [{ scenarioId: "existing mapped scenario id", evidenceId: "existing evidence id in that scenario" }],
                        confidence: "0..1",
                        recommendation: "string?",
                    }],
                unansweredQuestions: ["string"],
            },
        });
        await fs.writeFile(promptFile, `${projectAuditPrompt(taskFile)}\n`, "utf8");
        try {
            const sourceState = await captureBusinessSourceState(input.root);
            const agent = await runConfiguredAgent({ root: input.root, config: input.config.agent, promptFile, artifactPrefix: "project-audit" });
            await assertBusinessSourceUnchanged(input.root, sourceState);
            if (agent.exitCode !== 0)
                throw new Error(`全项目业务审计 Agent 执行失败，退出码 ${agent.exitCode}`);
            let candidate;
            try {
                candidate = JSON.parse(await fs.readFile(candidateFile, "utf8"));
            }
            catch (error) {
                if (error.code === "ENOENT")
                    throw new Error("全项目业务审计 Agent 未按协议写入 candidateFile");
                throw new Error(`全项目业务审计 Agent 输出的 JSON 无效：${error.message}`);
            }
            const finalized = finalizeProjectAgentAudit({ candidate, project });
            base.findings.push(...finalized.findings);
            base.agent = {
                status: "completed",
                provider: agent.provider,
                durationMs: agent.durationMs,
                conclusion: finalized.conclusion,
                unansweredQuestions: finalized.unansweredQuestions,
            };
            for (const question of finalized.unansweredQuestions)
                base.boundaries.push(`AI 待确认：${question}`);
            await fs.rm(candidateFile, { force: true });
        }
        catch (error) {
            const message = error.message;
            base.agent = { status: "failed", error: message };
            base.boundaries.push(`AI 全局业务逻辑审计未完成：${message}；确定性结构结果已保留。`);
        }
    }
    else {
        base.agent = { status: "skipped" };
        base.boundaries.push("因没有已建图场景，已跳过 AI 全局业务逻辑审计。请先运行 code-doctor project build --all。");
    }
    base.boundaries = [...new Set(base.boundaries)];
    const audit = { ...base, summary: summarizeProjectAudit(base) };
    const auditFile = path.join(output, "project-audit.json");
    await writeJson(auditFile, audit);
    const finalReport = await buildProjectReport(input.root);
    return { audit, auditFile, htmlFile: finalReport.htmlFile, reportFile: finalReport.jsonFile };
};
//# sourceMappingURL=audit.js.map