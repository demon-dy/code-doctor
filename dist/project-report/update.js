import fs from "node:fs/promises";
import path from "node:path";
import { minimatch } from "minimatch";
import { buildBusinessMap } from "../business-map/build.js";
import { ensureOutputDirectory, writeJson } from "../utils.js";
import { runCommandArgs } from "../process.js";
import { auditProjectBusiness } from "../project-audit/audit.js";
import { buildProjectReport } from "./build.js";
const IMPACT_FILE = "project-impact.json";
const SAFE_GIT_REVISION = /^[A-Za-z0-9._/@~^{}:+-]+$/;
export const validateGitRange = (value) => {
    const range = value.trim();
    if (!range || range.length > 256 || range.startsWith("-") || !SAFE_GIT_REVISION.test(range)) {
        throw new Error("Git range 无效或包含不安全字符");
    }
    return range;
};
export const rangeFromBase = (value) => `${validateGitRange(value)}...HEAD`;
const normalizeFile = (value) => value.replaceAll("\\", "/").replace(/^\.\//, "");
const changeStatus = (value) => {
    switch (value[0]) {
        case "A": return "added";
        case "M": return "modified";
        case "D": return "deleted";
        case "R": return "renamed";
        case "C": return "copied";
        case "T": return "type_changed";
        case "U": return "unmerged";
        default: return "unknown";
    }
};
export const parseGitNameStatus = (stdout) => {
    const fields = stdout.split("\0");
    if (fields.at(-1) === "")
        fields.pop();
    const changed = [];
    for (let index = 0; index < fields.length;) {
        const rawStatus = fields[index++] ?? "";
        const status = changeStatus(rawStatus);
        if (status === "renamed" || status === "copied") {
            const previousPath = normalizeFile(fields[index++] ?? "");
            const currentPath = normalizeFile(fields[index++] ?? "");
            if (previousPath && currentPath)
                changed.push({ path: currentPath, previousPath, status });
        }
        else {
            const file = normalizeFile(fields[index++] ?? "");
            if (file)
                changed.push({ path: file, status });
        }
    }
    return changed.filter((item) => !item.path.startsWith(".code-doctor/"));
};
export const readGitChanges = async (root, unsafeRange) => {
    const range = validateGitRange(unsafeRange);
    const result = await runCommandArgs({
        file: "git",
        args: ["diff", "--name-status", "-z", "--find-renames", range, "--"],
        cwd: root,
    });
    if (result.exitCode !== 0)
        throw new Error(`无法读取 Git 变更范围 ${range}：${result.stderr || result.stdout}`);
    return parseGitNameStatus(result.stdout);
};
const isBusinessSource = (file, config) => {
    const value = normalizeFile(file);
    const included = config.graph.include.some((pattern) => minimatch(value, pattern, { dot: true }));
    const excluded = config.graph.exclude.some((pattern) => minimatch(value, pattern, { dot: true }));
    return included && !excluded;
};
export const isGlobalProjectFile = (file) => {
    const value = normalizeFile(file).toLowerCase();
    const basename = path.posix.basename(value);
    if (/^(package(-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|go\.(mod|sum)|code-doctor\.ya?ml|tsconfig(?:\.[^.]+)?\.json)$/.test(basename))
        return true;
    if (/^(vite|vue|next|nuxt|webpack|rollup|eslint|babel|jest|vitest)\.config\./.test(basename))
        return true;
    return /(^|\/)(main|app|index|router|routes|store)\.(ts|tsx|js|jsx|mjs|cjs|vue|go)$/.test(value)
        || /(^|\/)\.env(?:\.|$)/.test(value);
};
const aliases = (change) => [change.path, ...(change.previousPath ? [change.previousPath] : [])].map(normalizeFile);
export const analyzeProjectImpact = (input) => {
    const scenarios = input.project.scenarios;
    const evidenceByScenario = new Map(scenarios.map((scenario) => [
        scenario.id,
        new Set(scenario.evidenceFiles.map(normalizeFile)),
    ]));
    const changedFiles = input.changes.map((change) => {
        const candidateFiles = aliases(change);
        const scenarioIds = scenarios
            .filter((scenario) => candidateFiles.some((file) => evidenceByScenario.get(scenario.id)?.has(file)))
            .map((scenario) => scenario.id);
        return {
            ...change,
            path: normalizeFile(change.path),
            previousPath: change.previousPath ? normalizeFile(change.previousPath) : undefined,
            businessSource: candidateFiles.some((file) => isBusinessSource(file, input.config)),
            global: candidateFiles.some(isGlobalProjectFile),
            scenarioIds,
        };
    });
    const impactedIds = new Set(changedFiles.flatMap((file) => file.scenarioIds));
    const impactedScenarios = scenarios
        .filter((scenario) => impactedIds.has(scenario.id))
        .map((scenario) => ({
        id: scenario.id,
        title: scenario.title,
        focus: scenario.focus,
        matchedFiles: changedFiles.filter((file) => file.scenarioIds.includes(scenario.id)).map((file) => file.path),
    }));
    const unattributedFiles = changedFiles.filter((file) => !file.scenarioIds.length).map((file) => file.path);
    const unknownBoundaries = [];
    const unattributedSource = changedFiles.filter((file) => file.businessSource && !file.scenarioIds.length);
    if (unattributedSource.length)
        unknownBoundaries.push(`${unattributedSource.length} 个业务源码变更尚未归属任何场景，不能判断为“无业务影响”：${unattributedSource.map((file) => file.path).join("、")}`);
    const globalChanges = changedFiles.filter((file) => file.global);
    if (globalChanges.length)
        unknownBoundaries.push(`检测到 ${globalChanges.length} 个全局入口、依赖或配置变更，可能跨越当前证据关联：${globalChanges.map((file) => file.path).join("、")}`);
    const destructive = changedFiles.filter((file) => file.status === "deleted" || file.status === "renamed");
    if (destructive.length)
        unknownBoundaries.push(`${destructive.length} 个文件被删除或重命名；已同时使用旧路径和新路径做影响关联，仍需复核失效入口与证据。`);
    const unmapped = scenarios.filter((scenario) => !scenario.map);
    if (unmapped.length)
        unknownBoundaries.push(`${unmapped.length} 个已发现业务场景尚未建图，增量分析无法证明这些场景未受影响。`);
    return {
        changedFiles,
        impactedScenarios,
        unchangedScenarioIds: scenarios.filter((scenario) => !impactedIds.has(scenario.id)).map((scenario) => scenario.id),
        unattributedFiles,
        unknownBoundaries,
    };
};
const readImpact = async (file) => {
    try {
        const value = JSON.parse(await fs.readFile(file, "utf8"));
        return value?.schemaVersion === 1 && Array.isArray(value.changedFiles) && Array.isArray(value.impactedScenarios) ? value : undefined;
    }
    catch (error) {
        if (error.code === "ENOENT")
            return undefined;
        return undefined;
    }
};
const writeImpact = async (file, report) => {
    const temporary = `${file}.${process.pid}.tmp`;
    await writeJson(temporary, report);
    await fs.rename(temporary, file);
};
const errorMessage = (error) => error instanceof Error ? error.message : String(error);
const currentCommit = async (root) => {
    const result = await runCommandArgs({ file: "git", args: ["rev-parse", "HEAD"], cwd: root });
    return result.exitCode === 0 ? result.stdout.trim() || undefined : undefined;
};
const defaultDependencies = {
    readChanges: readGitChanges,
    buildReport: buildProjectReport,
    buildMap: buildBusinessMap,
    audit: auditProjectBusiness,
    commit: currentCommit,
    now: () => new Date().toISOString(),
};
const sameChanges = (left, right) => JSON.stringify(left.map(({ path: file, previousPath, status }) => ({ file, previousPath, status })))
    === JSON.stringify(right.map(({ path: file, previousPath, status }) => ({ file, previousPath, status })));
export const updateProjectFromGit = async (input, overrides = {}) => {
    if (input.limit !== undefined && (!Number.isInteger(input.limit) || input.limit < 1))
        throw new Error("--limit 必须是大于 0 的整数");
    const dependencies = { ...defaultDependencies, ...overrides };
    const range = validateGitRange(input.range);
    const useAgent = input.useAgent !== false;
    const output = await ensureOutputDirectory(input.root);
    const impactFile = path.join(output, IMPACT_FILE);
    const [changes, initial, head, previous] = await Promise.all([
        dependencies.readChanges(input.root, range),
        dependencies.buildReport(input.root),
        dependencies.commit(input.root),
        readImpact(impactFile),
    ]);
    const analyzed = analyzeProjectImpact({ changes, project: initial.report, config: input.config });
    const canResume = previous?.range === range && previous.sourceCommit === head && sameChanges(previous.changedFiles, analyzed.changedFiles);
    const previousById = new Map((canResume ? previous?.impactedScenarios : [])?.map((scenario) => [scenario.id, scenario]) ?? []);
    const createdAt = canResume ? previous.createdAt : dependencies.now();
    const impactedScenarios = analyzed.impactedScenarios.map((scenario) => {
        const old = previousById.get(scenario.id);
        const completed = old?.status === "completed";
        return {
            ...scenario,
            status: completed ? "completed" : "pending",
            attempts: old?.attempts ?? 0,
            startedAt: completed ? old?.startedAt : undefined,
            completedAt: completed ? old?.completedAt : undefined,
        };
    });
    const impact = {
        schemaVersion: 1,
        createdAt,
        updatedAt: dependencies.now(),
        root: input.root,
        range,
        sourceCommit: head,
        status: "running",
        useAgent,
        limit: input.limit,
        changedFiles: analyzed.changedFiles,
        impactedScenarios,
        unchangedScenarioIds: analyzed.unchangedScenarioIds,
        unattributedFiles: analyzed.unattributedFiles,
        unknownBoundaries: [...analyzed.unknownBoundaries],
        audit: { status: "pending" },
    };
    await writeImpact(impactFile, impact);
    if (!useAgent) {
        for (const scenario of impact.impactedScenarios)
            if (scenario.status !== "completed")
                scenario.status = "skipped_no_agent";
        if (impact.impactedScenarios.some((scenario) => scenario.status === "skipped_no_agent")) {
            impact.unknownBoundaries.push("本次使用 --no-agent，受影响场景未重新建图；只会运行确定性项目审计。 ");
        }
        impact.updatedAt = dependencies.now();
        await writeImpact(impactFile, impact);
    }
    else {
        let attempted = 0;
        for (const scenario of impact.impactedScenarios) {
            if (scenario.status === "completed" || attempted >= (input.limit ?? Number.POSITIVE_INFINITY))
                continue;
            attempted += 1;
            scenario.status = "running";
            scenario.attempts += 1;
            scenario.startedAt = dependencies.now();
            scenario.completedAt = undefined;
            scenario.failedAt = undefined;
            scenario.error = undefined;
            impact.updatedAt = dependencies.now();
            await writeImpact(impactFile, impact);
            try {
                await dependencies.buildMap({
                    root: input.root,
                    config: input.config,
                    focus: scenario.focus,
                    scenarioId: scenario.id,
                    persist: true,
                    artifactPrefix: `update-${scenario.id}`,
                });
                scenario.status = "completed";
                scenario.completedAt = dependencies.now();
            }
            catch (error) {
                scenario.status = "failed";
                scenario.failedAt = dependencies.now();
                scenario.error = errorMessage(error);
            }
            impact.updatedAt = dependencies.now();
            await writeImpact(impactFile, impact);
        }
    }
    const pending = impact.impactedScenarios.filter((scenario) => scenario.status === "pending" || scenario.status === "skipped_no_agent");
    const failed = impact.impactedScenarios.filter((scenario) => scenario.status === "failed");
    if (pending.length)
        impact.unknownBoundaries.push(`${pending.length} 个受影响场景尚未重新建图，本次影响结论不完整。`);
    if (failed.length)
        impact.unknownBoundaries.push(`${failed.length} 个受影响场景重建失败：${failed.map((scenario) => `${scenario.title}（${scenario.error ?? "未知错误"}）`).join("、")}`);
    impact.unknownBoundaries = [...new Set(impact.unknownBoundaries.map((item) => item.trim()))];
    impact.status = pending.length ? "partial" : failed.length ? "completed_with_failures" : "completed";
    impact.updatedAt = dependencies.now();
    await writeImpact(impactFile, impact);
    try {
        const audited = await dependencies.audit({ root: input.root, config: input.config, useAgent });
        impact.audit = {
            status: audited.audit.agent.status === "failed" ? "failed" : "completed",
            sourceCommit: audited.audit.sourceCommit,
            agentStatus: audited.audit.agent.status,
            error: audited.audit.agent.error,
        };
        if (audited.audit.agent.status === "failed") {
            impact.status = pending.length ? "partial_with_failures" : "completed_with_failures";
            impact.unknownBoundaries.push(`增量后的 AI 项目审计失败：${audited.audit.agent.error ?? "未知错误"}`);
        }
    }
    catch (error) {
        impact.audit = { status: "failed", sourceCommit: head, error: errorMessage(error) };
        impact.status = pending.length ? "partial_with_failures" : "completed_with_failures";
        impact.unknownBoundaries.push(`增量后的项目审计失败：${errorMessage(error)}`);
    }
    impact.unknownBoundaries = [...new Set(impact.unknownBoundaries)];
    impact.updatedAt = dependencies.now();
    await writeImpact(impactFile, impact);
    const final = await dependencies.buildReport(input.root);
    return { impact, impactFile, report: final.report, htmlFile: final.htmlFile };
};
//# sourceMappingURL=update.js.map