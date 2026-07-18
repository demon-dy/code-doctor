import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { runCommand } from "./process.js";
import { pathExists, stableId, writeJson } from "./utils.js";
const KNOWLEDGE_README = `# Code Doctor 项目知识

这里解决 AI 审计结论无法随项目持续沉淀的问题。

- \`atlas.yaml\`：项目业务场景目录。
- \`scenarios/*.candidate.json\`：AI 从代码反推的候选地图，尚未成为业务事实。
- \`scenarios/*.json\`：经过人工 review 的场景地图。
- \`rules.yaml\`：人工确认的期望业务规则。
- \`questions.yaml\`：需要产品、历史 Owner 或运行证据回答的问题。
- \`takeover.yaml\`：新 Owner 的渐进式接管进度。

不要把 Agent 推断直接改成 reviewed。确认意味着审阅者愿意对这份业务理解负责。
`;
export const knowledgeDirectory = (root) => path.join(root, ".code-doctor", "knowledge");
const scenarioDirectory = (root) => path.join(knowledgeDirectory(root), "scenarios");
const atlasFile = (root) => path.join(knowledgeDirectory(root), "atlas.yaml");
const takeoverFile = (root) => path.join(knowledgeDirectory(root), "takeover.yaml");
const rulesFile = (root) => path.join(knowledgeDirectory(root), "rules.yaml");
const writeYaml = async (file, value) => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, YAML.stringify(value, { lineWidth: 100 }), "utf8");
};
const readYaml = async (file) => YAML.parse(await fs.readFile(file, "utf8"));
export const initializeKnowledge = async (root) => {
    const created = [];
    const directory = knowledgeDirectory(root);
    await fs.mkdir(scenarioDirectory(root), { recursive: true });
    const now = new Date().toISOString();
    const files = [
        ["README.md", KNOWLEDGE_README],
        ["project.yaml", { schemaVersion: 1, name: path.basename(root), summary: "", initializedAt: now }],
        ["atlas.yaml", { schemaVersion: 1, updatedAt: now, scenarios: [] }],
        ["rules.yaml", { schemaVersion: 1, rules: [] }],
        ["questions.yaml", { schemaVersion: 1, questions: [] }],
        ["takeover.yaml", { schemaVersion: 1, updatedAt: now, scenarios: [] }],
        [path.join("scenarios", ".gitkeep"), ""],
    ];
    for (const [relative, value] of files) {
        const file = path.join(directory, relative);
        if (await pathExists(file))
            continue;
        if (typeof value === "string")
            await fs.writeFile(file, value, "utf8");
        else
            await writeYaml(file, value);
        created.push(path.relative(root, file).split(path.sep).join("/"));
    }
    return created;
};
export const scenarioIdFromFocus = (focus) => `scenario-${stableId(focus).slice(0, 10)}`;
const normalizeScenarioId = (value) => {
    const normalized = value.trim().toLowerCase().replaceAll(/[^a-z0-9_-]+/g, "-").replaceAll(/^-+|-+$/g, "");
    if (!normalized)
        throw new Error("场景 id 只能包含字母、数字、短横线或下划线");
    return normalized;
};
const currentCommit = async (root) => {
    const result = await runCommand({ command: "git rev-parse HEAD", cwd: root });
    return result.exitCode === 0 ? result.stdout.trim() || undefined : undefined;
};
const readAtlas = async (root) => {
    await initializeKnowledge(root);
    return readYaml(atlasFile(root));
};
const updateAtlas = async (root, entry) => {
    const atlas = await readAtlas(root);
    const index = atlas.scenarios.findIndex((item) => item.id === entry.id);
    if (index >= 0)
        atlas.scenarios[index] = { ...atlas.scenarios[index], ...entry };
    else
        atlas.scenarios.push(entry);
    atlas.updatedAt = new Date().toISOString();
    atlas.scenarios.sort((a, b) => a.title.localeCompare(b.title, "zh-CN"));
    await writeYaml(atlasFile(root), atlas);
};
export const saveScenarioCandidate = async (input) => {
    await initializeKnowledge(input.root);
    const id = normalizeScenarioId(input.id ?? scenarioIdFromFocus(input.map.focus));
    const now = new Date().toISOString();
    const reviewedFile = path.join(scenarioDirectory(input.root), `${id}.json`);
    const reviewed = await readScenarioFile(reviewedFile).catch(() => undefined);
    const map = { ...input.map, root: ".", agent: undefined };
    const record = {
        schemaVersion: 1,
        id,
        title: map.title,
        focus: map.focus,
        status: "candidate",
        createdAt: reviewed?.createdAt ?? now,
        updatedAt: now,
        sourceCommit: await currentCommit(input.root),
        map,
    };
    const file = path.join(scenarioDirectory(input.root), `${id}.candidate.json`);
    await writeJson(file, record);
    await updateAtlas(input.root, {
        id,
        title: record.title,
        focus: record.focus,
        status: reviewed ? "reviewed" : "candidate",
        updatedAt: now,
        candidateAvailable: true,
    });
    await syncTakeover(input.root);
    return { id, file };
};
const readScenarioFile = async (file) => JSON.parse(await fs.readFile(file, "utf8"));
export const loadScenario = async (root, id, preferCandidate = false) => {
    const normalized = normalizeScenarioId(id);
    const candidate = path.join(scenarioDirectory(root), `${normalized}.candidate.json`);
    const reviewed = path.join(scenarioDirectory(root), `${normalized}.json`);
    const order = preferCandidate ? [candidate, reviewed] : [reviewed, candidate];
    for (const file of order)
        if (await pathExists(file))
            return readScenarioFile(file);
    throw new Error(`没有找到业务场景：${normalized}`);
};
export const listScenarios = async (root) => (await readAtlas(root)).scenarios;
export const listRules = async (root, scenarioId) => {
    await initializeKnowledge(root);
    const document = await readYaml(rulesFile(root));
    return (document.rules ?? []).filter((rule) => !scenarioId || rule.scenarioId === normalizeScenarioId(scenarioId));
};
export const addConfirmedRule = async (input) => {
    const id = normalizeScenarioId(input.id);
    const scenarioId = normalizeScenarioId(input.scenarioId);
    const statement = input.statement.trim();
    const reviewer = input.reviewer.trim();
    if (!statement || !reviewer)
        throw new Error("业务规则必须包含 statement 和 reviewer");
    if (!(await listScenarios(input.root)).some((entry) => entry.id === scenarioId))
        throw new Error(`业务场景不存在：${scenarioId}`);
    const rules = await listRules(input.root);
    const now = new Date().toISOString();
    const existing = rules.find((rule) => rule.id === id);
    const rule = {
        id,
        scenarioId,
        statement,
        status: "confirmed",
        confirmedBy: reviewer,
        confirmedAt: existing?.confirmedAt ?? now,
        updatedAt: now,
    };
    const index = rules.findIndex((item) => item.id === id);
    if (index >= 0)
        rules[index] = rule;
    else
        rules.push(rule);
    await writeYaml(rulesFile(input.root), { schemaVersion: 1, rules });
    return rule;
};
export const saveDiscoveredScenarios = async (root, entries) => {
    const atlas = await readAtlas(root);
    for (const entry of entries) {
        const index = atlas.scenarios.findIndex((item) => item.id === entry.id);
        if (index >= 0) {
            const existing = atlas.scenarios[index];
            atlas.scenarios[index] = {
                ...existing,
                ...entry,
                status: existing.status,
                candidateAvailable: existing.candidateAvailable,
            };
        }
        else
            atlas.scenarios.push(entry);
    }
    atlas.updatedAt = new Date().toISOString();
    await writeYaml(atlasFile(root), atlas);
    await syncTakeover(root);
    return atlas;
};
export const saveProjectSummaryCandidate = async (root, summary) => {
    await initializeKnowledge(root);
    const file = path.join(knowledgeDirectory(root), "project.candidate.yaml");
    await writeYaml(file, {
        schemaVersion: 1,
        summary,
        generatedAt: new Date().toISOString(),
        status: "candidate",
        note: "AI 从代码反推的项目定位，需人工 review 后再合并到 project.yaml。",
    });
    return file;
};
export const confirmScenario = async (input) => {
    const id = normalizeScenarioId(input.id);
    const reviewer = input.reviewer.trim();
    if (!reviewer)
        throw new Error("确认业务地图必须提供 reviewer");
    const candidateFile = path.join(scenarioDirectory(input.root), `${id}.candidate.json`);
    const candidate = await readScenarioFile(candidateFile).catch(() => undefined);
    if (!candidate)
        throw new Error(`场景 ${id} 没有待确认的候选地图`);
    const now = new Date().toISOString();
    const reviewed = {
        ...candidate,
        status: "reviewed",
        updatedAt: now,
        reviewedBy: reviewer,
        reviewedAt: now,
    };
    const file = path.join(scenarioDirectory(input.root), `${id}.json`);
    await writeJson(file, reviewed);
    await fs.rm(candidateFile, { force: true });
    await updateAtlas(input.root, {
        id,
        title: reviewed.title,
        focus: reviewed.focus,
        status: "reviewed",
        updatedAt: now,
        candidateAvailable: false,
    });
    await syncTakeover(input.root);
    return reviewed;
};
const readTakeover = async (root) => {
    await initializeKnowledge(root);
    return readYaml(takeoverFile(root));
};
const syncTakeover = async (root) => {
    const atlas = await readAtlas(root);
    const state = await readTakeover(root);
    for (const entry of atlas.scenarios) {
        const existing = state.scenarios.find((item) => item.id === entry.id);
        if (existing)
            existing.title = entry.title;
        else
            state.scenarios.push({ id: entry.id, title: entry.title, status: "unstarted" });
    }
    state.updatedAt = new Date().toISOString();
    await writeYaml(takeoverFile(root), state);
    return state;
};
export const startTakeover = async (root, owner) => {
    const state = await syncTakeover(root);
    state.startedAt ??= new Date().toISOString();
    if (owner?.trim())
        state.owner = owner.trim();
    state.updatedAt = new Date().toISOString();
    await writeYaml(takeoverFile(root), state);
    return state;
};
export const nextTakeoverScenario = async (root) => {
    const state = await syncTakeover(root);
    const current = state.scenarios.find((item) => item.status === "in_progress");
    if (current)
        return current;
    const atlas = await readAtlas(root);
    const understood = new Set(state.scenarios.filter((item) => item.status === "understood").map((item) => item.id));
    const priority = { critical: 0, high: 1, normal: 2 };
    const candidates = state.scenarios
        .filter((item) => item.status === "unstarted")
        .map((item) => ({ item, entry: atlas.scenarios.find((entry) => entry.id === item.id) }))
        .filter(({ entry }) => (entry?.dependsOn ?? []).every((id) => understood.has(id)))
        .sort((a, b) => (priority[a.entry?.priority ?? "normal"] - priority[b.entry?.priority ?? "normal"]));
    const next = candidates[0]?.item ?? state.scenarios.find((item) => item.status === "unstarted");
    if (!next)
        return undefined;
    next.status = "in_progress";
    state.updatedAt = new Date().toISOString();
    await writeYaml(takeoverFile(root), state);
    return next;
};
export const confirmTakeoverScenario = async (input) => {
    await loadScenario(input.root, input.id);
    const owner = input.owner.trim();
    if (!owner)
        throw new Error("确认接管理解必须提供 owner");
    const state = await syncTakeover(input.root);
    const scenario = state.scenarios.find((item) => item.id === normalizeScenarioId(input.id));
    if (!scenario)
        throw new Error(`接管计划中没有场景：${input.id}`);
    scenario.status = "understood";
    scenario.confirmedBy = owner;
    scenario.confirmedAt = new Date().toISOString();
    state.updatedAt = new Date().toISOString();
    await writeYaml(takeoverFile(input.root), state);
    return state;
};
export const takeoverProgress = async (root) => {
    const state = await syncTakeover(root);
    const total = state.scenarios.length;
    const understood = state.scenarios.filter((item) => item.status === "understood").length;
    return { state, total, understood, percent: total ? Math.round(understood * 100 / total) : 0 };
};
//# sourceMappingURL=knowledge.js.map