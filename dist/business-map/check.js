import fs from "node:fs/promises";
import path from "node:path";
import { runConfiguredAgent } from "../agent.js";
import { ensureOutputDirectory, writeJson } from "../utils.js";
import { finalizeAuditReport } from "./schema.js";
import { renderAuditReport } from "./render.js";
import { assertBusinessSourceUnchanged, captureBusinessSourceState } from "./worktree.js";
const checkPrompt = (taskFile) => `你是 Code Doctor 的 AI 业务代码审计 Agent。请读取任务文件：${taskFile}

请把人类需求与现有业务地图、源码和测试进行对照，形成有证据的最终审计结论。

执行要求：
1. 先把 requirement 解释为角色、前置条件和预期结果；不要偷偷补充需求，所有假设都必须列出。
2. 阅读 businessMapFile。证据不足时可以继续检查项目源码、测试和 Git 历史，但报告只能引用地图中已有的 node id 和 evidence id。
3. 主动寻找反证，检查结果是否不可达、条件冲突、路径遗漏或前后端语义不一致。
4. 每个 finding 必须是 satisfied、violated 或 uncertain；证据不足必须选择 uncertain。
5. confidence 使用 0 到 1。高置信结论必须有源码或测试证据，不得只基于命名猜测。
6. 不修改业务地图和任何项目源码。
7. 将最终 JSON 写入任务指定的 candidateFile。不要只在终端输出 JSON。

JSON 必须满足任务文件中的 outputContract。`;
export const checkBusinessRequirement = async (input) => {
    const output = await ensureOutputDirectory(input.root);
    const artifactId = input.artifactId?.trim().toLowerCase().replaceAll(/[^a-z0-9_-]+/g, "-").replaceAll(/^-+|-+$/g, "");
    const suffix = artifactId ? `.${artifactId}` : "";
    const mapFile = path.join(output, `business-map${suffix}.json`);
    let map;
    if (input.map) {
        map = input.map;
        await writeJson(mapFile, map);
    }
    else {
        try {
            map = JSON.parse(await fs.readFile(path.join(output, "business-map.json"), "utf8"));
        }
        catch (error) {
            if (error.code === "ENOENT")
                throw new Error("尚未生成业务地图，请先运行 code-doctor map build --focus <业务场景>");
            throw new Error(`无法读取业务地图：${error.message}`);
        }
    }
    const candidateFile = path.join(output, `audit-report${suffix}.candidate.json`);
    const taskFile = path.join(input.root, ".code-doctor", `check${artifactId ? `-${artifactId}` : ""}-task.json`);
    const promptFile = path.join(input.root, ".code-doctor", `check${artifactId ? `-${artifactId}` : ""}-prompt.md`);
    await fs.rm(candidateFile, { force: true });
    await writeJson(taskFile, {
        schemaVersion: 1,
        kind: "business-requirement-check",
        root: input.root,
        requirement: input.requirement,
        businessMapFile: mapFile,
        candidateFile,
        outputContract: {
            expectation: { interpretation: "string", actors: ["string"], preconditions: ["string"], expectedOutcomes: ["string"], assumptions: ["string"] },
            conclusion: "string",
            findings: [{ id: "string", status: "satisfied|violated|uncertain", severity: "error|warning|info", title: "string", conclusion: "string", reasoning: ["string"], relatedNodeIds: ["existing node id"], evidenceIds: ["existing evidence id"], confidence: "0..1", recommendation: "string?" }],
            unansweredQuestions: ["string"],
        },
    });
    await fs.writeFile(promptFile, `${checkPrompt(taskFile)}\n`, "utf8");
    const sourceState = await captureBusinessSourceState(input.root);
    const agent = await runConfiguredAgent({ root: input.root, config: input.config.agent, promptFile, artifactPrefix: artifactId ? `check-${artifactId}` : "check" });
    await assertBusinessSourceUnchanged(input.root, sourceState);
    if (agent.exitCode !== 0)
        throw new Error(`业务审计 Agent 执行失败，退出码 ${agent.exitCode}`);
    let candidate;
    try {
        candidate = JSON.parse(await fs.readFile(candidateFile, "utf8"));
    }
    catch (error) {
        if (error.code === "ENOENT")
            throw new Error("业务审计 Agent 未按协议写入 candidateFile");
        throw new Error(`业务审计 Agent 输出的 JSON 无效：${error.message}`);
    }
    const report = finalizeAuditReport({ candidate, root: input.root, requirement: input.requirement, map, agent });
    const reportFile = path.join(output, `audit-report${suffix}.json`);
    const htmlFile = path.join(output, `audit-report${suffix}.html`);
    await writeJson(reportFile, report);
    await fs.writeFile(htmlFile, renderAuditReport(map, report), "utf8");
    await fs.rm(candidateFile, { force: true });
    return { report, reportFile, htmlFile };
};
//# sourceMappingURL=check.js.map