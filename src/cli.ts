#!/usr/bin/env node
import path from "node:path";
import { createRequire } from "node:module";
import { Command } from "commander";
import pc from "picocolors";
import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import { buildBusinessMap } from "./business-map/build.js";
import { checkBusinessRequirement } from "./business-map/check.js";
import { discoverBusinessScenarios } from "./business-map/discover.js";
import { auditChanged, auditDeep } from "./audit.js";
import { loadConfig } from "./config.js";
import { fixOneIssue } from "./fix.js";
import { analyzeCodeGraph } from "./graph/analyze.js";
import { writeGraphArtifacts } from "./graph/render.js";
import { initializeProject, installGitLabCi, type CiMode } from "./init.js";
import {
  confirmScenario,
  addConfirmedRule,
  confirmTakeoverScenario,
  listScenarios,
  listRules,
  loadScenario,
  nextTakeoverScenario,
  startTakeover,
  takeoverProgress,
} from "./knowledge.js";
import { scanFailureMessages, scanProject } from "./scan.js";

const rootOption = (command: Command): Command =>
  command.option("-C, --root <directory>", "项目根目录", process.cwd());

const resolveRoot = (value: string): string => path.resolve(value);
const packageVersion = (createRequire(import.meta.url)("../package.json") as { version: string }).version;

const configureAgent = (config: Awaited<ReturnType<typeof loadConfig>>, provider?: string): void => {
  if (provider) config.agent.provider = provider as typeof config.agent.provider;
};

const openLocalFile = async (file: string): Promise<void> => {
  await fs.access(file);
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", file] : [file];
  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  child.unref();
};

const program = new Command()
  .name("code-doctor")
  .description("持续从代码反推业务、沉淀项目知识并发现实现偏差的 AI 业务代码审计系统")
  .version(packageVersion);

rootOption(program.command("init").description("初始化 code-doctor.yaml 和忽略规则"))
  .action(async (options: { root: string }) => {
    const root = resolveRoot(options.root);
    const files = await initializeProject(root);
    console.log(pc.green(`已初始化 ${root}`));
    for (const file of files) console.log(`  ${file}`);
  });

rootOption(program.command("scan").description("扫描整个历史代码库并输出统一诊断"))
  .option("--json", "只输出 JSON")
  .action(async (options: { root: string; json?: boolean }) => {
    const root = resolveRoot(options.root);
    const config = await loadConfig(root);
    const report = await scanProject({ root, config });
    const failures = scanFailureMessages(report);
    if (options.json) console.log(JSON.stringify(report));
    else {
      console.log(pc.bold(`发现 ${report.diagnostics.length} 个问题`));
      for (const diagnostic of report.diagnostics.slice(0, 20)) {
        console.log(`${diagnostic.severity === "error" ? pc.red("●") : pc.yellow("●")} ${diagnostic.rule} ${pc.dim(`${diagnostic.location.file}:${diagnostic.location.line ?? "?"}`)}`);
        console.log(`  ${diagnostic.message}`);
      }
      if (report.diagnostics.length > 20) console.log(pc.dim(`另有 ${report.diagnostics.length - 20} 个问题，详见 .code-doctor/output/diagnostics.json`));
      for (const failure of failures) console.error(pc.red(`扫描失败：${failure}`));
    }
    if (failures.length) process.exitCode = 1;
  });

rootOption(program.command("graph").description("生成 JS/TS/Vue/Go 静态调用图和可交互 HTML"))
  .action(async (options: { root: string }) => {
    const root = resolveRoot(options.root);
    const config = await loadConfig(root);
    const graph = await analyzeCodeGraph({ root, config });
    const files = await writeGraphArtifacts(root, graph);
    console.log(pc.green(`调用图已生成：${files.htmlFile}`));
    console.log(pc.dim(`${graph.stats.nodes} 个节点，${graph.stats.edges} 条边，${graph.stats.endpoints} 个接口`));
  });

const map = program.command("map").description("AI 业务地图：理解、展示并审计代码实际表达的业务行为");

rootOption(map.command("discover").description("从整个项目发现新 Owner 应该逐步理解的候选业务场景"))
  .option("--agent <provider>", "auto、codex、claude 或 custom")
  .action(async (options: { root: string; agent?: string }) => {
    const root = resolveRoot(options.root);
    const config = await loadConfig(root);
    configureAgent(config, options.agent);
    const result = await discoverBusinessScenarios({ root, config });
    console.log(pc.bold(result.projectSummary));
    console.log(pc.green(`已发现并沉淀 ${result.scenarios.length} 个候选业务场景：`));
    for (const scenario of result.scenarios) console.log(`${scenario.priority === "critical" ? pc.red("●") : scenario.priority === "high" ? pc.yellow("●") : "○"} ${scenario.id}  ${scenario.title}`);
    console.log(pc.dim("这些只是 AI 候选目录；请逐个运行 map build 建图并人工 review。"));
  });

rootOption(map.command("build").description("让 Agent 从代码和技术图生成可追溯业务地图"))
  .requiredOption("--focus <business-scenario>", "本次要理解的业务场景、页面、入口或问题")
  .option("--id <scenario-id>", "稳定的业务场景 id，用于后续增量审计和接管")
  .option("--no-save", "只生成临时报告，不写入项目知识目录")
  .option("--agent <provider>", "auto、codex、claude 或 custom")
  .action(async (options: { root: string; focus: string; id?: string; save: boolean; agent?: string }) => {
    const root = resolveRoot(options.root);
    const config = await loadConfig(root);
    configureAgent(config, options.agent);
    const result = await buildBusinessMap({ root, config, focus: options.focus, scenarioId: options.id, persist: options.save });
    console.log(pc.green(`AI 业务地图已生成：${result.htmlFile}`));
    console.log(pc.dim(`${result.map.nodes.length} 个业务节点，${result.map.edges.length} 条路径，${result.map.evidence.length} 条证据`));
    if (result.map.uncertainties.length) console.log(pc.yellow(`仍有 ${result.map.uncertainties.length} 个不确定项，请人工校准`));
    if (result.knowledge) console.log(pc.cyan(`候选场景已沉淀：${result.knowledge.id}（需运行 map confirm 后才成为人工确认知识）`));
  });

rootOption(map.command("list").description("列出项目已经沉淀的业务场景"))
  .action(async (options: { root: string }) => {
    const entries = await listScenarios(resolveRoot(options.root));
    if (!entries.length) {
      console.log(pc.yellow("尚无业务场景，请先运行 map build --focus <业务场景> --id <id>"));
      return;
    }
    for (const entry of entries) {
      const record = await loadScenario(resolveRoot(options.root), entry.id).catch(() => undefined);
      const update = entry.candidateAvailable && entry.status === "reviewed" ? " · 有待审更新" : "";
      const state = entry.status === "reviewed" ? "已确认" : record ? "候选地图" : "候选目录";
      console.log(`${entry.status === "reviewed" ? pc.green("●") : pc.yellow("●")} ${entry.id}  ${entry.title} ${pc.dim(`· ${state}${update}`)}`);
    }
  });

rootOption(map.command("confirm").description("把经过人工 review 的候选地图提升为项目知识"))
  .argument("<scenario-id>", "要确认的业务场景 id")
  .requiredOption("--by <reviewer>", "确认人；确认意味着愿意对这份业务理解负责")
  .action(async (scenarioId: string, options: { root: string; by: string }) => {
    const record = await confirmScenario({ root: resolveRoot(options.root), id: scenarioId, reviewer: options.by });
    console.log(pc.green(`已确认业务场景 ${record.id}，确认人：${record.reviewedBy}`));
  });

rootOption(map.command("check").description("用自然语言需求检查业务地图并生成证据化结论"))
  .argument("<requirement>", "要检查的业务需求")
  .option("--agent <provider>", "auto、codex、claude 或 custom")
  .action(async (requirement: string, options: { root: string; agent?: string }) => {
    const root = resolveRoot(options.root);
    const config = await loadConfig(root);
    configureAgent(config, options.agent);
    const result = await checkBusinessRequirement({ root, config, requirement });
    console.log(pc.bold(result.report.conclusion));
    for (const finding of result.report.findings) {
      const marker = finding.status === "violated" ? pc.red("●") : finding.status === "satisfied" ? pc.green("●") : pc.yellow("●");
      console.log(`${marker} ${finding.title} ${pc.dim(`${Math.round(finding.confidence * 100)}%`)}`);
      console.log(`  ${finding.conclusion}`);
    }
    console.log(pc.dim(`完整审计报告：${result.htmlFile}`));
  });

rootOption(map.command("ask").description("check 的对话式别名：向当前业务地图提出问题"))
  .argument("<question>", "关于业务行为的问题或期望")
  .option("--agent <provider>", "auto、codex、claude 或 custom")
  .action(async (question: string, options: { root: string; agent?: string }) => {
    const root = resolveRoot(options.root);
    const config = await loadConfig(root);
    configureAgent(config, options.agent);
    const result = await checkBusinessRequirement({ root, config, requirement: question });
    console.log(result.report.conclusion);
    console.log(pc.dim(`证据化回答：${result.htmlFile}`));
  });

rootOption(map.command("open").description("打开最近生成的 AI 业务地图或审计报告"))
  .option("--report", "打开审计报告而不是业务地图", false)
  .action(async (options: { root: string; report: boolean }) => {
    const root = resolveRoot(options.root);
    const file = path.join(root, ".code-doctor", "output", options.report ? "audit-report.html" : "business-map.html");
    await openLocalFile(file);
    console.log(file);
  });

const takeover = program.command("takeover").description("帮助新 Owner 渐进式理解和接管项目");

const rule = program.command("rule").description("管理由人类确认、供持续审计使用的业务规则");

rootOption(rule.command("add").description("为业务场景添加或更新一条人工确认规则"))
  .requiredOption("--id <rule-id>", "稳定的规则 id")
  .requiredOption("--scenario <scenario-id>", "所属业务场景")
  .requiredOption("--statement <rule>", "应该满足的业务规则")
  .requiredOption("--by <reviewer>", "确认人")
  .action(async (options: { root: string; id: string; scenario: string; statement: string; by: string }) => {
    const saved = await addConfirmedRule({ root: resolveRoot(options.root), id: options.id, scenarioId: options.scenario, statement: options.statement, reviewer: options.by });
    console.log(pc.green(`已保存人工确认规则 ${saved.id}：${saved.statement}`));
  });

rootOption(rule.command("list").description("列出人工确认的业务规则"))
  .option("--scenario <scenario-id>", "只查看一个业务场景")
  .action(async (options: { root: string; scenario?: string }) => {
    const rules = await listRules(resolveRoot(options.root), options.scenario);
    if (!rules.length) console.log(pc.yellow("尚无人工确认业务规则"));
    for (const item of rules) console.log(`${pc.green("●")} ${item.id} [${item.scenarioId}] ${item.statement} ${pc.dim(`· ${item.confirmedBy}`)}`);
  });

rootOption(takeover.command("start").description("启动或继续项目接管计划"))
  .option("--owner <name>", "当前接管 Owner")
  .action(async (options: { root: string; owner?: string }) => {
    const state = await startTakeover(resolveRoot(options.root), options.owner);
    console.log(pc.green(`接管计划已启动：${state.scenarios.length} 个业务场景`));
    if (!state.scenarios.length) console.log(pc.yellow("请先用 map build 建立至少一个业务场景"));
  });

rootOption(takeover.command("next").description("获取依赖顺序中的下一个待理解场景"))
  .action(async (options: { root: string }) => {
    const root = resolveRoot(options.root);
    const next = await nextTakeoverScenario(root);
    if (!next) {
      console.log(pc.green("当前业务场景已全部理解"));
      return;
    }
    console.log(pc.bold(`${next.title} (${next.id})`));
    const entry = (await listScenarios(root)).find((item) => item.id === next.id);
    const record = await loadScenario(root, next.id).catch(() => undefined);
    console.log(`聚焦：${record?.focus ?? entry?.focus ?? next.title}`);
    if (!record) console.log(pc.yellow(`该场景尚未建图，请运行 map build --focus ${JSON.stringify(entry?.focus ?? next.title)} --id ${next.id}`));
    console.log(pc.dim(`状态：${record?.status ?? "仅有候选目录"}；完成理解后运行 takeover confirm ${next.id} --by <owner>`));
  });

rootOption(takeover.command("confirm").description("由 Owner 确认已经理解一个业务场景"))
  .argument("<scenario-id>", "业务场景 id")
  .requiredOption("--by <owner>", "接管 Owner")
  .action(async (scenarioId: string, options: { root: string; by: string }) => {
    await confirmTakeoverScenario({ root: resolveRoot(options.root), id: scenarioId, owner: options.by });
    const progress = await takeoverProgress(resolveRoot(options.root));
    console.log(pc.green(`已记录理解：${scenarioId}；当前进度 ${progress.understood}/${progress.total} (${progress.percent}%)`));
  });

rootOption(takeover.command("progress").description("查看项目渐进式接管进度"))
  .action(async (options: { root: string }) => {
    const progress = await takeoverProgress(resolveRoot(options.root));
    console.log(pc.bold(`接管进度 ${progress.understood}/${progress.total} (${progress.percent}%)`));
    for (const item of progress.state.scenarios) console.log(`${item.status === "understood" ? pc.green("✓") : item.status === "in_progress" ? pc.yellow("→") : "○"} ${item.id}  ${item.title}`);
  });

rootOption(program.command("audit").description("按 Git 变更或定时任务持续审计已沉淀的业务场景"))
  .option("--changed <git-range>", "只审计 Git 范围影响的业务场景")
  .option("--deep", "对已沉淀场景执行深度历史审计", false)
  .option("--one", "本次最多审计一个场景", false)
  .option("--agent <provider>", "auto、codex、claude 或 custom")
  .action(async (options: { root: string; changed?: string; deep: boolean; one: boolean; agent?: string }) => {
    if (Boolean(options.changed) === Boolean(options.deep)) throw new Error("audit 必须且只能选择 --changed <range> 或 --deep");
    const root = resolveRoot(options.root);
    const config = await loadConfig(root);
    configureAgent(config, options.agent);
    const result = options.changed
      ? await auditChanged({ root, config, range: options.changed, one: options.one })
      : await auditDeep({ root, config, one: options.one });
    console.log(pc.bold(`已审计 ${result.selectedScenarios.length} 个业务场景`));
    for (const item of result.selectedScenarios) console.log(`${pc.green("●")} ${item.id}  ${item.title}`);
    if (result.uncoveredFiles.length) console.log(pc.yellow(`${result.uncoveredFiles.length} 个变更文件尚未被任何业务场景覆盖`));
    if (result.deferredScenarios.length) console.log(pc.yellow(`${result.deferredScenarios.length} 个受影响场景因本次运行上限延后审计`));
    for (const item of result.reports) console.log(pc.dim(`${item.scenarioId}: ${item.htmlFile}`));
  });

const addFixOptions = (command: Command): Command =>
  rootOption(command)
    .option("--one", "每次只修复一个问题", true)
    .option("--agent <provider>", "auto、codex、claude 或 custom")
    .option("--open-mr", "修复通过后推送并创建 GitLab MR", false);

addFixOptions(program.command("fix").description("选择一个历史问题并交给 Agent 修复"))
  .action(async (options: { root: string; agent?: string; openMr: boolean }) => {
    const root = resolveRoot(options.root);
    const config = await loadConfig(root);
    configureAgent(config, options.agent);
    const record = await fixOneIssue({ root, config, openMergeRequest: options.openMr });
    if (record.error) {
      console.error(pc.red(`修复失败：${record.error}`));
      process.exitCode = 1;
      return;
    }
    if (!record.selectedDiagnostic) {
      console.log(pc.green("没有待处理问题"));
      return;
    }
    console.log(pc.green(`已修复 ${record.selectedDiagnostic.rule}`));
    if (record.mergeRequestUrl) console.log(record.mergeRequestUrl);
  });

addFixOptions(program.command("run").description("扫描、画图、修复一个问题并可创建 MR"))
  .action(async (options: { root: string; agent?: string; openMr: boolean }) => {
    const root = resolveRoot(options.root);
    const config = await loadConfig(root);
    configureAgent(config, options.agent);
    if (config.graph.enabled) {
      const graph = await analyzeCodeGraph({ root, config });
      await writeGraphArtifacts(root, graph);
      console.log(pc.dim(`调用图：${graph.stats.nodes} 个节点，${graph.stats.edges} 条边`));
    }
    const record = await fixOneIssue({ root, config, openMergeRequest: options.openMr });
    if (record.error) {
      console.error(pc.red(`修复失败：${record.error}`));
      process.exitCode = 1;
    } else if (!record.selectedDiagnostic) console.log(pc.green("没有待处理问题"));
    else {
      console.log(pc.green(`已修复 ${record.selectedDiagnostic.rule}`));
      if (record.mergeRequestUrl) console.log(record.mergeRequestUrl);
    }
  });

const ci = program.command("ci").description("安装持续业务审计 CI 集成");
rootOption(ci.command("install").description("写入 GitLab MR、Push、定时审计模板"))
  .option("--mode <mode>", "mr、push、daily、both（MR+每日）或 all", "both")
  .action(async (options: { root: string; mode: string }) => {
    if (!new Set(["mr", "push", "daily", "both", "all"]).has(options.mode)) throw new Error("CI mode 必须是 mr、push、daily、both 或 all");
    const files = await installGitLabCi(resolveRoot(options.root), options.mode as CiMode);
    console.log(pc.green("GitLab CI 模板已安装"));
    for (const file of files) console.log(`  ${file}`);
  });

program.parseAsync().catch((error: unknown) => {
  console.error(pc.red((error as Error).stack ?? String(error)));
  process.exitCode = 1;
});
