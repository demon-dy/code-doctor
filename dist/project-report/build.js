import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { initializeKnowledge, knowledgeDirectory, listScenarios } from "../knowledge.js";
import { runCommand } from "../process.js";
import { ensureOutputDirectory, pathExists, writeJson } from "../utils.js";
import { renderProjectReport } from "./render.js";
const readYaml = async (file) => {
    try {
        return YAML.parse(await fs.readFile(file, "utf8"));
    }
    catch (error) {
        if (error.code === "ENOENT")
            return undefined;
        throw error;
    }
};
const readJson = async (file) => {
    try {
        return JSON.parse(await fs.readFile(file, "utf8"));
    }
    catch (error) {
        if (error.code === "ENOENT")
            return undefined;
        throw error;
    }
};
const asMap = (value) => {
    if (!value || typeof value !== "object")
        return undefined;
    const item = value;
    // 兼容早期直接把 BusinessMap 写进 scenarios/*.json 的知识目录。
    const normalize = (map) => ({
        ...map,
        chapters: Array.isArray(map.chapters) && map.chapters.length
            ? map.chapters
            : [{ id: "legacy-overview", title: "业务流程", summary: map.summary, nodeIds: map.nodes.map((node) => node.id) }],
        uncertainties: Array.isArray(map.uncertainties) ? map.uncertainties : [],
    });
    if (item.map && Array.isArray(item.map.nodes))
        return { map: normalize(item.map), sourceCommit: item.sourceCommit, updatedAt: item.updatedAt };
    if (Array.isArray(item.nodes) && Array.isArray(item.edges) && Array.isArray(item.evidence)) {
        return { map: normalize(item), updatedAt: item.createdAt };
    }
    return undefined;
};
const orphanScenarioEntries = async (root, known) => {
    const directory = path.join(knowledgeDirectory(root), "scenarios");
    const names = await fs.readdir(directory).catch(() => []);
    const ids = [...new Set(names
            .filter((name) => name.endsWith(".json"))
            .map((name) => name.replace(/\.candidate\.json$|\.json$/g, ""))
            .filter((id) => id && !known.has(id)))];
    const entries = [];
    for (const id of ids) {
        const files = scenarioFiles(root, id);
        const [reviewedValue, candidateValue] = await Promise.all([readJson(files.reviewed), readJson(files.candidate)]);
        const selected = asMap(candidateValue) ?? asMap(reviewedValue);
        if (!selected)
            continue;
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
const currentCommit = async (root) => {
    const result = await runCommand({ command: "git rev-parse HEAD", cwd: root });
    return result.exitCode === 0 ? result.stdout.trim() || undefined : undefined;
};
const changedEvidenceFiles = async (root, from, files) => {
    if (!files.length)
        return [];
    // sourceCommit 来自可持久化的知识文件，不能直接拼进 shell。这里只接受 Git 对象 ID，
    // 并先读取整个提交范围的变更，再在内存中与证据文件求交集。
    if (!/^[0-9a-f]{7,64}$/i.test(from))
        return undefined;
    const result = await runCommand({
        command: `git diff --name-only ${from}..HEAD --`,
        cwd: root,
    });
    if (result.exitCode !== 0)
        return undefined;
    const evidenceFiles = new Set(files.map((file) => file.replaceAll("\\", "/")));
    return result.stdout
        .split(/\r?\n/)
        .map((file) => file.trim().replaceAll("\\", "/"))
        .filter((file) => file && evidenceFiles.has(file));
};
const scenarioFiles = (root, id) => {
    const directory = path.join(knowledgeDirectory(root), "scenarios");
    return {
        reviewed: path.join(directory, `${id}.json`),
        candidate: path.join(directory, `${id}.candidate.json`),
    };
};
const buildScenario = async (root, entry, head, buildRun) => {
    const files = scenarioFiles(root, entry.id);
    const [reviewedValue, candidateValue] = await Promise.all([readJson(files.reviewed), readJson(files.candidate)]);
    const reviewed = asMap(reviewedValue);
    const candidate = asMap(candidateValue);
    const selected = candidate ?? reviewed;
    const state = candidate && reviewed
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
        .filter((file) => Boolean(file));
    let freshness = "unknown";
    let changed = [];
    if (selected?.sourceCommit && head) {
        if (selected.sourceCommit === head)
            freshness = "current";
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
        buildStatus: buildRun?.status,
        buildError: buildRun?.error,
        updatedAt: selected?.updatedAt ?? entry.updatedAt,
        sourceCommit: selected?.sourceCommit,
        changedEvidenceFiles: changed,
        map: selected?.map,
    };
};
export const buildProjectReport = async (root) => {
    await initializeKnowledge(root);
    const knowledge = knowledgeDirectory(root);
    const [atlasEntries, atlasDocument, project, candidateProject, head, buildRunValue, auditValue] = await Promise.all([
        listScenarios(root),
        readYaml(path.join(knowledge, "atlas.yaml")),
        readYaml(path.join(knowledge, "project.yaml")),
        readYaml(path.join(knowledge, "project.candidate.yaml")),
        currentCommit(root),
        readJson(path.join(root, ".code-doctor", "output", "project-build-run.json")),
        readJson(path.join(root, ".code-doctor", "output", "project-audit.json")),
    ]);
    const atlas = [...atlasEntries, ...await orphanScenarioEntries(root, new Set(atlasEntries.map((entry) => entry.id)))];
    const buildRun = buildRunValue;
    const validBuildRunScenarios = buildRun?.schemaVersion === 1 && Array.isArray(buildRun.scenarios)
        ? buildRun.scenarios
        : [];
    const buildRunById = new Map(validBuildRunScenarios.map((scenario) => [scenario.id, scenario]));
    const scenarios = await Promise.all(atlas.map((entry) => buildScenario(root, entry, head, buildRunById.get(entry.id))));
    const confirmedSummary = project?.summary?.trim() ?? "";
    const candidateSummary = candidateProject?.summary?.trim() ?? "";
    const summary = confirmedSummary || candidateSummary || "尚未形成项目业务定位。";
    const evidenceFiles = new Set(scenarios.flatMap((scenario) => scenario.evidenceFiles));
    const missingFiles = new Set(scenarios.flatMap((scenario) => scenario.missingEvidenceFiles));
    const mapped = scenarios.filter((scenario) => scenario.state !== "unmapped").length;
    const reviewed = scenarios.filter((scenario) => scenario.state === "reviewed" || scenario.state === "pending_review").length;
    const pendingReview = scenarios.filter((scenario) => scenario.state === "pending_review").length;
    const unknownBoundaries = [];
    const scenarioIds = new Set(scenarios.map((scenario) => scenario.id));
    for (const scenario of scenarios) {
        const missingDependencies = scenario.dependsOn.filter((id) => !scenarioIds.has(id));
        if (missingDependencies.length)
            unknownBoundaries.push(`“${scenario.title}”引用了不存在的前置场景：${missingDependencies.join("、")}。`);
    }
    const byId = new Map(scenarios.map((scenario) => [scenario.id, scenario]));
    const visiting = new Set();
    const visited = new Set();
    const cyclic = new Set();
    const visit = (id, trail) => {
        if (visiting.has(id)) {
            for (const item of trail.slice(trail.indexOf(id)))
                cyclic.add(item);
            return;
        }
        if (visited.has(id))
            return;
        visiting.add(id);
        for (const dependency of byId.get(id)?.dependsOn ?? [])
            if (byId.has(dependency))
                visit(dependency, [...trail, dependency]);
        visiting.delete(id);
        visited.add(id);
    };
    for (const scenario of scenarios)
        visit(scenario.id, [scenario.id]);
    if (cyclic.size)
        unknownBoundaries.push(`业务场景依赖存在循环：${[...cyclic].sort().join("、")}；批量建图会使用稳定顺序兜底，但接管顺序需人工校准。`);
    if (!confirmedSummary && candidateSummary)
        unknownBoundaries.push("项目定位仍是 AI 候选，尚未经过人工确认。");
    if (!atlas.length)
        unknownBoundaries.push("尚未运行全项目业务发现，当前没有业务场景目录。");
    const unmapped = scenarios.filter((scenario) => scenario.state === "unmapped");
    if (unmapped.length)
        unknownBoundaries.push(`${unmapped.length} 个候选业务场景尚未建图，无法判断其内部链路是否完整。`);
    const buildFailed = scenarios.filter((scenario) => scenario.buildStatus === "failed");
    const buildPending = scenarios.filter((scenario) => scenario.buildStatus === "pending" || scenario.buildStatus === "running");
    if (buildFailed.length)
        unknownBoundaries.push(`${buildFailed.length} 个业务场景建图失败；失败不代表业务不存在，需要修复 Agent 或证据问题后继续。`);
    for (const scenario of buildFailed)
        unknownBoundaries.push(`“${scenario.title}”建图失败：${scenario.buildError ?? "未知错误"}`);
    if (buildPending.length)
        unknownBoundaries.push(`${buildPending.length} 个业务场景仍待处理，本报告不是全场景建图结果。`);
    if (missingFiles.size)
        unknownBoundaries.push(`${missingFiles.size} 个证据文件不存在，相关结论无法从当前工作区复核。`);
    for (const scenario of scenarios) {
        if (scenario.freshness === "stale")
            unknownBoundaries.push(`“${scenario.title}”的证据代码在建图后发生变化，需要重新审计。`);
        for (const uncertainty of scenario.map?.uncertainties ?? [])
            unknownBoundaries.push(`“${scenario.title}”：${uncertainty}`);
        const uncertainNodes = scenario.map?.nodes.filter((node) => node.status === "unknown" || node.status === "conflicted").length ?? 0;
        if (uncertainNodes)
            unknownBoundaries.push(`“${scenario.title}”包含 ${uncertainNodes} 个未知或证据冲突节点。`);
    }
    const report = {
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
            buildPending: buildPending.length,
            buildFailed: buildFailed.length,
            evidenceFiles: evidenceFiles.size,
            existingEvidenceFiles: evidenceFiles.size - missingFiles.size,
            mapPercent: scenarios.length ? Math.round(mapped * 100 / scenarios.length) : 0,
            reviewPercent: scenarios.length ? Math.round(reviewed * 100 / scenarios.length) : 0,
        },
        unknownBoundaries: [...new Set(unknownBoundaries)],
    };
    const audit = auditValue;
    if (audit?.schemaVersion === 1 && Array.isArray(audit.findings) && audit.agent && audit.summary && Array.isArray(audit.boundaries)) {
        report.audit = audit;
        if (audit.sourceCommit && head && audit.sourceCommit !== head)
            report.unknownBoundaries.push("项目风险审计生成后源码提交已变化，需要重新运行 project audit。");
        const auditMaps = new Map((audit.auditedScenarios ?? []).map((item) => [item.id, item.mapCreatedAt]));
        const changedAuditMaps = scenarios.filter((scenario) => scenario.map && auditMaps.get(scenario.id) !== scenario.map.createdAt);
        if (changedAuditMaps.length)
            report.unknownBoundaries.push(`${changedAuditMaps.length} 个场景地图在项目风险审计后发生变化，需要重新运行 project audit。`);
        report.unknownBoundaries = [...new Set(report.unknownBoundaries)];
    }
    const output = await ensureOutputDirectory(root);
    const jsonFile = path.join(output, "project-report.json");
    const htmlFile = path.join(output, "project-report.html");
    await writeJson(jsonFile, report);
    await fs.writeFile(htmlFile, renderProjectReport(report), "utf8");
    return { report, jsonFile, htmlFile };
};
//# sourceMappingURL=build.js.map