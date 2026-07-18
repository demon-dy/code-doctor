import fs from "node:fs/promises";
import path from "node:path";
import { runConfiguredAgent } from "../agent.js";
import { analyzeCodeGraph } from "../graph/analyze.js";
import { writeGraphArtifacts } from "../graph/render.js";
import { ensureOutputDirectory, writeJson } from "../utils.js";
import { renderBusinessMap } from "./render.js";
import { finalizeBusinessMap } from "./schema.js";
import { assertBusinessSourceUnchanged, captureBusinessSourceState } from "./worktree.js";
import { saveScenarioCandidate } from "../knowledge.js";
const buildPrompt = (taskFile) => `你是 Code Doctor 的 AI 业务代码审计 Agent。请读取任务文件：${taskFile}

你的目标不是罗列函数，而是理解代码表达的业务行为，并把复杂实现压缩成一张人类能读懂的业务执行图。

执行要求：
1. 阅读任务中的 technicalGraphFile，并按 focus 主动阅读相关源码、测试和配置；必要时查看 Git 历史。
2. 只保留 actor、scenario、state、decision、action、outcome、side_effect、system 等关键业务节点。
3. 每个实现事实必须引用 source/test 证据；源码证据必须使用项目相对路径和真实行号。
4. 无法从代码证明的业务含义标记为 inference、unknown 或 conflicted，不得伪装为 fact。
   confirmed 只表示已有 human 证据的人工确认，Agent 不得自行使用 confirmed。
5. 决策边尽量填写 guard，明确“什么条件导致什么结果”。
6. 优先生成一张局部、清晰、可排查的图，不要复制整个技术调用图。
7. 把节点归纳成 4～8 个按业务推进顺序排列的 chapters；标题必须是业务语言。每个节点必须且只能属于一个章节。
8. 不修改任何业务源码、测试、依赖或 Git 状态。
9. 将最终 JSON 写入任务指定的 candidateFile。不要只在终端输出 JSON。

JSON 必须满足任务文件中的 outputContract。完成后简要说明读取范围、关键不确定性和输出路径。`;
export const buildBusinessMap = async (input) => {
    if (!input.config.businessMap.enabled)
        throw new Error("businessMap.enabled=false，AI 业务地图已被项目配置禁用");
    const output = await ensureOutputDirectory(input.root);
    const graph = await analyzeCodeGraph({ root: input.root, config: input.config });
    const graphFiles = await writeGraphArtifacts(input.root, graph);
    const candidateFile = path.join(output, "business-map.candidate.json");
    const taskFile = path.join(input.root, ".code-doctor", "map-task.json");
    const promptFile = path.join(input.root, ".code-doctor", "map-prompt.md");
    await fs.rm(candidateFile, { force: true });
    await writeJson(taskFile, {
        schemaVersion: 1,
        kind: "business-map-build",
        root: input.root,
        focus: input.focus,
        technicalGraphFile: graphFiles.jsonFile,
        candidateFile,
        limits: input.config.businessMap,
        outputContract: {
            title: "string",
            summary: "string",
            chapters: [{ id: "string", title: "string", summary: "string", nodeIds: ["node-id"] }],
            nodes: [{ id: "string", label: "string", kind: "scenario|actor|state|decision|action|outcome|side_effect|system", summary: "string", status: "fact|inference|confirmed|unknown|conflicted", evidenceIds: ["string"] }],
            edges: [{ id: "string", from: "node-id", to: "node-id", label: "string?", guard: "string?", status: "fact|inference|confirmed|unknown|conflicted", confidence: "0..1", evidenceIds: ["string"] }],
            evidence: [{ id: "string", kind: "source|test|git|runtime|human|agent", description: "string", location: { file: "project-relative-path", line: "positive integer" }, reference: "string?", confidence: "0..1" }],
            uncertainties: ["string"],
        },
    });
    await fs.writeFile(promptFile, `${buildPrompt(taskFile)}\n`, "utf8");
    const sourceState = await captureBusinessSourceState(input.root);
    const agent = await runConfiguredAgent({ root: input.root, config: input.config.agent, promptFile, artifactPrefix: input.artifactPrefix ?? "map" });
    await assertBusinessSourceUnchanged(input.root, sourceState);
    if (agent.exitCode !== 0)
        throw new Error(`业务地图 Agent 执行失败，退出码 ${agent.exitCode}`);
    let raw;
    try {
        raw = JSON.parse(await fs.readFile(candidateFile, "utf8"));
    }
    catch (error) {
        if (error.code === "ENOENT")
            throw new Error("业务地图 Agent 未按协议写入 candidateFile");
        throw new Error(`业务地图 Agent 输出的 JSON 无效：${error.message}`);
    }
    const map = await finalizeBusinessMap({ candidate: raw, root: input.root, focus: input.focus, config: input.config.businessMap, agent });
    const jsonFile = path.join(output, "business-map.json");
    const htmlFile = path.join(output, "business-map.html");
    await writeJson(jsonFile, map);
    await fs.writeFile(htmlFile, renderBusinessMap(map), "utf8");
    await fs.rm(candidateFile, { force: true });
    await writeJson(path.join(output, "map-run.json"), {
        schemaVersion: 1,
        createdAt: map.createdAt,
        focus: input.focus,
        agent: map.agent,
        nodes: map.nodes.length,
        chapters: map.chapters.length,
        edges: map.edges.length,
        evidence: map.evidence.length,
        technicalGraph: graph.stats,
    });
    const knowledge = input.persist === false
        ? undefined
        : await saveScenarioCandidate({ root: input.root, map, id: input.scenarioId });
    return { map, jsonFile, htmlFile, knowledge };
};
//# sourceMappingURL=build.js.map