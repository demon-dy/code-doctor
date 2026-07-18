import fs from "node:fs/promises";
import path from "node:path";
import { runConfiguredAgent } from "../agent.js";
import { analyzeCodeGraph } from "../graph/analyze.js";
import { writeGraphArtifacts } from "../graph/render.js";
import { saveDiscoveredScenarios, saveProjectSummaryCandidate } from "../knowledge.js";
import type { CodeDoctorConfig, KnowledgeAtlasEntry } from "../types.js";
import { ensureOutputDirectory, writeJson } from "../utils.js";
import { assertBusinessSourceUnchanged, captureBusinessSourceState } from "./worktree.js";

const prompt = (taskFile: string): string => `你是 Code Doctor 的项目接管 Agent。读取任务文件：${taskFile}

请从整个代码库反推“值得新 Owner 逐步理解的业务场景目录”，不是列技术模块或文件夹。

要求：
1. 阅读 technicalGraphFile，并抽样阅读入口、路由、页面、状态、接口、测试和 Git 历史。
2. 场景应是“某类用户在某个触发下，经过判断得到业务结果”，例如“登录成功后的会员状态刷新”，而不是“utils目录”。
3. 只选 6 到 20 个高价值场景；优先覆盖入口、多下游依赖、高变更、支付、权限、全局状态和异常处理。
4. 标注 critical/high/normal 优先级和前置场景 dependsOn，让新 Owner 可以渐进式学习。
5. evidenceFiles 只能填写真实存在的项目相对路径；业务含义仍是 AI 候选，不得冒充人工确认。
6. 不修改项目源码。把 JSON 写入 candidateFile。

输出必须满足 outputContract。`;

const safeId = (value: unknown): string => {
  if (typeof value !== "string") throw new Error("场景 id 必须是字符串");
  const id = value.trim().toLowerCase().replaceAll(/[^a-z0-9_-]+/g, "-").replaceAll(/^-+|-+$/g, "");
  if (!id) throw new Error("场景 id 无效");
  return id;
};

const text = (value: unknown, name: string): string => {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} 必须是非空字符串`);
  return value.trim();
};

export const discoverBusinessScenarios = async (input: {
  root: string;
  config: CodeDoctorConfig;
}): Promise<{ projectSummary: string; scenarios: KnowledgeAtlasEntry[]; candidateFile: string }> => {
  const output = await ensureOutputDirectory(input.root);
  const graph = await analyzeCodeGraph({ root: input.root, config: input.config });
  const graphFiles = await writeGraphArtifacts(input.root, graph);
  const candidateFile = path.join(output, "atlas.candidate.json");
  const taskFile = path.join(input.root, ".code-doctor", "discover-task.json");
  const promptFile = path.join(input.root, ".code-doctor", "discover-prompt.md");
  await fs.rm(candidateFile, { force: true });
  await writeJson(taskFile, {
    schemaVersion: 1,
    kind: "business-scenario-discovery",
    root: input.root,
    technicalGraphFile: graphFiles.jsonFile,
    candidateFile,
    outputContract: {
      projectSummary: "string",
      scenarios: [{ id: "kebab-case", title: "string", focus: "string", summary: "string", priority: "critical|high|normal", dependsOn: ["scenario-id"], evidenceFiles: ["project-relative-path"] }],
    },
  });
  await fs.writeFile(promptFile, `${prompt(taskFile)}\n`, "utf8");
  const sourceState = await captureBusinessSourceState(input.root);
  const agent = await runConfiguredAgent({ root: input.root, config: input.config.agent, promptFile, artifactPrefix: "discover" });
  await assertBusinessSourceUnchanged(input.root, sourceState);
  if (agent.exitCode !== 0) throw new Error(`项目发现 Agent 执行失败，退出码 ${agent.exitCode}`);
  const raw = JSON.parse(await fs.readFile(candidateFile, "utf8")) as Record<string, unknown>;
  const projectSummary = text(raw.projectSummary, "projectSummary");
  if (!Array.isArray(raw.scenarios) || raw.scenarios.length < 1 || raw.scenarios.length > 20) throw new Error("项目发现必须输出 1 到 20 个业务场景");
  const now = new Date().toISOString();
  const scenarios: KnowledgeAtlasEntry[] = [];
  for (const [index, value] of raw.scenarios.entries()) {
    if (!value || typeof value !== "object") throw new Error(`scenarios[${index}] 必须是对象`);
    const item = value as Record<string, unknown>;
    const id = safeId(item.id);
    const priority = text(item.priority, `scenarios[${index}].priority`);
    if (!new Set(["critical", "high", "normal"]).has(priority)) throw new Error(`场景 ${id} 的 priority 无效`);
    const dependsOn = Array.isArray(item.dependsOn) ? item.dependsOn.map(safeId) : [];
    const evidenceFiles = Array.isArray(item.evidenceFiles) ? item.evidenceFiles.map((file) => text(file, `场景 ${id} evidenceFiles`)) : [];
    for (const file of evidenceFiles) {
      const absolute = path.resolve(input.root, file);
      if (path.relative(input.root, absolute).startsWith("..") || !(await fs.stat(absolute).catch(() => undefined))?.isFile()) {
        throw new Error(`场景 ${id} 引用了不存在的证据文件：${file}`);
      }
    }
    scenarios.push({
      id,
      title: text(item.title, `scenarios[${index}].title`),
      focus: text(item.focus, `scenarios[${index}].focus`),
      summary: text(item.summary, `scenarios[${index}].summary`),
      priority: priority as KnowledgeAtlasEntry["priority"],
      dependsOn,
      evidenceFiles,
      status: "candidate",
      updatedAt: now,
      candidateAvailable: false,
    });
  }
  const ids = new Set(scenarios.map((item) => item.id));
  if (ids.size !== scenarios.length) throw new Error("项目发现输出了重复的场景 id");
  for (const scenario of scenarios) scenario.dependsOn = scenario.dependsOn?.filter((id) => ids.has(id) && id !== scenario.id);
  await saveDiscoveredScenarios(input.root, scenarios);
  await saveProjectSummaryCandidate(input.root, projectSummary);
  return { projectSummary, scenarios, candidateFile };
};
