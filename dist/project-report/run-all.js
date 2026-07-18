import fs from "node:fs/promises";
import path from "node:path";
import { buildBusinessMap } from "../business-map/build.js";
import { discoverBusinessScenarios } from "../business-map/discover.js";
import { listScenarios, loadScenario } from "../knowledge.js";
import { ensureOutputDirectory, writeJson } from "../utils.js";
import { buildProjectReport } from "./build.js";
const STATE_FILE = "project-build-run.json";
const priorityRank = { critical: 0, high: 1, normal: 2 };
const compareScenario = (left, right) => {
    const priority = priorityRank[left.priority ?? "normal"] - priorityRank[right.priority ?? "normal"];
    return priority || left.id.localeCompare(right.id, "en");
};
/** 依赖优先的稳定拓扑序；循环依赖无法满足时仍按优先级稳定处理，避免整批停摆。 */
export const orderProjectScenarios = (entries) => {
    const byId = new Map(entries.map((entry) => [entry.id, entry]));
    const indegree = new Map(entries.map((entry) => [entry.id, 0]));
    const downstream = new Map(entries.map((entry) => [entry.id, []]));
    for (const entry of entries) {
        for (const dependency of new Set(entry.dependsOn ?? [])) {
            if (dependency === entry.id || !byId.has(dependency))
                continue;
            indegree.set(entry.id, (indegree.get(entry.id) ?? 0) + 1);
            downstream.get(dependency)?.push(entry.id);
        }
    }
    const ready = entries.filter((entry) => indegree.get(entry.id) === 0).sort(compareScenario);
    const ordered = [];
    while (ready.length) {
        const entry = ready.shift();
        ordered.push(entry);
        for (const id of downstream.get(entry.id) ?? []) {
            const next = (indegree.get(id) ?? 1) - 1;
            indegree.set(id, next);
            if (next === 0) {
                ready.push(byId.get(id));
                ready.sort(compareScenario);
            }
        }
    }
    const visited = new Set(ordered.map((entry) => entry.id));
    return [...ordered, ...entries.filter((entry) => !visited.has(entry.id)).sort(compareScenario)];
};
const readState = async (file) => {
    try {
        const value = JSON.parse(await fs.readFile(file, "utf8"));
        return value?.schemaVersion === 1 && Array.isArray(value.scenarios) ? value : undefined;
    }
    catch (error) {
        if (error.code === "ENOENT")
            return undefined;
        throw error;
    }
};
const writeState = async (file, state) => {
    const temporary = `${file}.${process.pid}.tmp`;
    await writeJson(temporary, state);
    await fs.rename(temporary, file);
};
const errorMessage = (error) => error instanceof Error ? error.message : String(error);
const defaultDependencies = {
    list: listScenarios,
    discover: discoverBusinessScenarios,
    buildMap: buildBusinessMap,
    hasMap: async (root, id) => Boolean(await loadScenario(root, id).catch(() => undefined)),
    buildReport: buildProjectReport,
    now: () => new Date().toISOString(),
};
const summarizeStatus = (scenarios) => {
    const pending = scenarios.some((scenario) => scenario.status === "pending" || scenario.status === "running");
    const failed = scenarios.some((scenario) => scenario.status === "failed");
    if (pending)
        return "partial";
    return failed ? "completed_with_failures" : "completed";
};
export const runAllProjectScenarios = async (input, overrides = {}) => {
    if (input.limit !== undefined && (!Number.isInteger(input.limit) || input.limit < 1)) {
        throw new Error("--limit 必须是大于 0 的整数");
    }
    const dependencies = { ...defaultDependencies, ...overrides };
    const output = await ensureOutputDirectory(input.root);
    const stateFile = path.join(output, STATE_FILE);
    let entries = await dependencies.list(input.root);
    let discoveryPerformed = false;
    if (!entries.length) {
        await dependencies.discover({ root: input.root, config: input.config });
        discoveryPerformed = true;
        entries = await dependencies.list(input.root);
    }
    const ordered = orderProjectScenarios(entries);
    const ids = new Set();
    for (const entry of ordered) {
        if (!/^[a-z0-9][a-z0-9_-]*$/.test(entry.id))
            throw new Error(`业务场景 id 无效：${entry.id}`);
        if (ids.has(entry.id))
            throw new Error(`业务场景 id 重复：${entry.id}`);
        ids.add(entry.id);
    }
    const previous = await readState(stateFile);
    const previousById = new Map(previous?.scenarios.map((scenario) => [scenario.id, scenario]) ?? []);
    const scenarios = [];
    for (const entry of ordered) {
        const old = previousById.get(entry.id);
        const mapExists = await dependencies.hasMap(input.root, entry.id);
        let status;
        if (input.refresh)
            status = "pending";
        // Agent 可能已经保存地图，但进程在下一次状态落盘前被终止。只要不是一次明确
        // 失败的尝试，已有地图就是可恢复的完成证据，避免再次消耗 Agent 调用。
        else if (mapExists && old?.status !== "failed")
            status = "completed";
        else if (old?.status === "failed")
            status = "failed"; // 未真正开始重试前保留失败原因。
        else
            status = "pending"; // running 表示上次被中断，本次恢复为待处理。
        scenarios.push({
            id: entry.id,
            title: entry.title,
            focus: entry.focus || entry.title,
            status,
            attempts: input.refresh ? 0 : Number.isInteger(old?.attempts) && (old?.attempts ?? -1) >= 0 ? old.attempts : 0,
            startedAt: status === "completed" || status === "failed" ? old?.startedAt : undefined,
            completedAt: status === "completed" ? old?.completedAt ?? entry.updatedAt : undefined,
            failedAt: status === "failed" ? old?.failedAt : undefined,
            error: status === "failed" ? old?.error : undefined,
        });
    }
    const state = {
        schemaVersion: 1,
        startedAt: input.refresh || !previous ? dependencies.now() : previous.startedAt,
        updatedAt: dependencies.now(),
        status: "running",
        discoveryPerformed: Boolean(previous?.discoveryPerformed || discoveryPerformed),
        scenarios,
    };
    await writeState(stateFile, state);
    let attempted = 0;
    for (const scenario of state.scenarios) {
        if ((scenario.status !== "pending" && scenario.status !== "failed") || attempted >= (input.limit ?? Number.POSITIVE_INFINITY))
            continue;
        attempted += 1;
        scenario.status = "running";
        scenario.attempts += 1;
        scenario.startedAt = dependencies.now();
        scenario.completedAt = undefined;
        scenario.failedAt = undefined;
        scenario.error = undefined;
        state.updatedAt = dependencies.now();
        await writeState(stateFile, state);
        try {
            await dependencies.buildMap({
                root: input.root,
                config: input.config,
                focus: scenario.focus,
                scenarioId: scenario.id,
                persist: true,
                artifactPrefix: `map-${scenario.id}`,
            });
            scenario.status = "completed";
            scenario.completedAt = dependencies.now();
        }
        catch (error) {
            scenario.status = "failed";
            scenario.failedAt = dependencies.now();
            scenario.error = errorMessage(error);
        }
        state.updatedAt = dependencies.now();
        await writeState(stateFile, state);
    }
    state.status = summarizeStatus(state.scenarios);
    state.updatedAt = dependencies.now();
    if (state.status === "completed" || state.status === "completed_with_failures")
        state.completedAt = dependencies.now();
    else
        state.completedAt = undefined;
    await writeState(stateFile, state);
    const project = await dependencies.buildReport(input.root);
    return {
        state,
        stateFile,
        report: project.report,
        htmlFile: project.htmlFile,
        attempted,
        completed: state.scenarios.filter((scenario) => scenario.status === "completed").length,
        failed: state.scenarios.filter((scenario) => scenario.status === "failed").length,
    };
};
//# sourceMappingURL=run-all.js.map