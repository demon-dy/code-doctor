import fs from "node:fs/promises";
import path from "node:path";
import { commandExists, pathExists } from "../utils.js";
import { loadConfig, CONFIG_FILE } from "../config.js";
import { listScenarios, loadScenario } from "../knowledge.js";
import { runCommandArgs } from "../process.js";
const sourceExtensions = new Map([
    [".ts", "TypeScript"], [".tsx", "TypeScript"], [".mts", "TypeScript"], [".cts", "TypeScript"],
    [".js", "JavaScript"], [".jsx", "JavaScript"], [".mjs", "JavaScript"], [".cjs", "JavaScript"],
    [".vue", "Vue"], [".go", "Go"],
]);
const ignoredDirectories = new Set([".git", ".code-doctor", "node_modules", "dist", "build", "coverage", "vendor"]);
const detectLanguages = async (root) => {
    const found = new Set();
    const visit = async (directory) => {
        const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
        for (const entry of entries) {
            if (found.size === 4)
                return;
            if (entry.isDirectory()) {
                if (!ignoredDirectories.has(entry.name))
                    await visit(path.join(directory, entry.name));
            }
            else if (entry.isFile()) {
                const language = sourceExtensions.get(path.extname(entry.name).toLowerCase());
                if (language)
                    found.add(language);
            }
        }
    };
    await visit(root);
    return [...found].sort();
};
const checkAgent = async (agent) => {
    if (agent.provider === "codex" || agent.provider === "claude") {
        const available = await commandExists(agent.provider);
        return available
            ? { available, resolvedProvider: agent.provider, message: `${agent.provider} 命令可用` }
            : { available, message: `未找到 ${agent.provider} 命令`, suggestion: `安装并登录 ${agent.provider}，或在 code-doctor.yaml 配置 custom Agent` };
    }
    if (agent.provider === "auto") {
        if (await commandExists("codex"))
            return { available: true, resolvedProvider: "codex", message: "auto 将使用 codex" };
        if (await commandExists("claude"))
            return { available: true, resolvedProvider: "claude", message: "auto 将使用 claude" };
        return { available: false, message: "auto 未找到 codex 或 claude", suggestion: "安装并登录任一 Agent，或配置 agent.provider=custom 与 agent.command" };
    }
    if (!agent.command?.trim())
        return { available: false, message: "custom Agent 缺少 command", suggestion: "在 code-doctor.yaml 设置 agent.command，并使用 {promptFile} / {root} 占位符或环境变量" };
    const executable = agent.command.trim().match(/^(?:env\s+)?([^\s]+)/)?.[1]?.replace(/^['"]|['"]$/g, "");
    const available = Boolean(executable && await commandExists(executable));
    return available
        ? { available, resolvedProvider: "custom", message: `custom Agent 已配置，入口 ${executable} 可用` }
        : { available, message: `custom Agent 入口不可用：${executable ?? "无法识别"}`, suggestion: "检查 agent.command 的第一个可执行命令是否已安装并可从 PATH 访问" };
};
export const inspectProject = async (root, configOverride) => {
    const checks = [];
    const stat = await fs.stat(root).catch(() => undefined);
    if (!stat?.isDirectory()) {
        return { schemaVersion: 1, createdAt: new Date().toISOString(), root, ready: false, checks: [{ id: "root", status: "fail", message: "项目目录不存在", suggestion: "使用 -C 指定真实项目根目录" }], languages: [], knowledge: { discovered: 0, mapped: 0, reviewed: 0 }, agent: { provider: "auto", available: false } };
    }
    checks.push({ id: "root", status: "pass", message: "项目目录可读取" });
    const major = Number(process.versions.node.split(".")[0]);
    checks.push(major >= 20
        ? { id: "node", status: "pass", message: `Node.js ${process.versions.node}` }
        : { id: "node", status: "fail", message: `Node.js ${process.versions.node} 过旧`, suggestion: "升级到 Node.js 20 或更高版本" });
    const gitAvailable = await commandExists("git");
    const gitRepository = gitAvailable && (await runCommandArgs({ file: "git", args: ["rev-parse", "--is-inside-work-tree"], cwd: root })).exitCode === 0;
    checks.push(!gitAvailable
        ? { id: "git", status: "warn", message: "未找到 Git；仍可建图，但无法判断地图新鲜度和变更影响", suggestion: "安装 Git 后可启用增量审计" }
        : gitRepository
            ? { id: "git", status: "pass", message: "Git 仓库可用" }
            : { id: "git", status: "warn", message: "当前目录不是 Git 仓库；仍可建图，但新鲜度为未知", suggestion: "如需持续审计，请先初始化或克隆 Git 仓库" });
    let config;
    try {
        config = configOverride ?? await loadConfig(root);
        checks.push(await pathExists(path.join(root, CONFIG_FILE))
            ? { id: "config", status: "pass", message: `${CONFIG_FILE} 可读取` }
            : { id: "config", status: "warn", message: `尚未初始化，将使用默认配置`, suggestion: "运行 code-doctor init 或 code-doctor project start" });
    }
    catch (error) {
        checks.push({ id: "config", status: "fail", message: `配置无法读取：${error.message}`, suggestion: `修复 ${CONFIG_FILE} 的 YAML 格式和字段` });
    }
    const languages = await detectLanguages(root);
    checks.push(languages.length
        ? { id: "languages", status: "pass", message: `检测到 ${languages.join("、")}`, details: { languages } }
        : { id: "languages", status: "warn", message: "未检测到 TS/JS/Vue/Go 业务源码", suggestion: "确认 -C 指向项目根目录；空项目只会生成覆盖边界报告" });
    const agentResult = await checkAgent(config?.agent ?? { provider: "auto" });
    checks.push({ id: "agent", status: agentResult.available ? "pass" : "warn", message: agentResult.message, suggestion: agentResult.suggestion });
    const businessMapEnabled = config?.businessMap.enabled !== false;
    checks.push(businessMapEnabled
        ? { id: "business-map", status: "pass", message: "AI 业务地图已启用" }
        : { id: "business-map", status: "warn", message: "businessMap.enabled=false，只能生成技术图和覆盖边界", suggestion: "如需从代码反推业务，请在 code-doctor.yaml 启用 businessMap" });
    const knowledgeExists = await pathExists(path.join(root, ".code-doctor", "knowledge", "atlas.yaml"));
    const entries = knowledgeExists ? await listScenarios(root).catch(() => []) : [];
    let mapped = 0;
    for (const entry of entries)
        if (await loadScenario(root, entry.id).then(() => true).catch(() => false))
            mapped += 1;
    const reviewed = entries.filter((entry) => entry.status === "reviewed").length;
    checks.push(entries.length
        ? { id: "knowledge", status: mapped === entries.length ? "pass" : "warn", message: `业务知识：发现 ${entries.length}，已建图 ${mapped}，人工确认 ${reviewed}`, suggestion: mapped < entries.length ? "再次运行 project start 或 project build --all 继续未完成场景" : undefined }
        : { id: "knowledge", status: "warn", message: "尚未发现业务场景", suggestion: "运行 code-doctor project start" });
    return {
        schemaVersion: 1,
        createdAt: new Date().toISOString(),
        root,
        ready: !checks.some((check) => check.status === "fail") && languages.length > 0 && agentResult.available && businessMapEnabled,
        checks,
        languages,
        knowledge: { discovered: entries.length, mapped, reviewed },
        agent: { provider: config?.agent.provider ?? "auto", available: agentResult.available, resolvedProvider: agentResult.resolvedProvider },
    };
};
//# sourceMappingURL=doctor.js.map