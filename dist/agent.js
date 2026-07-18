import fs from "node:fs/promises";
import path from "node:path";
import { runCommand } from "./process.js";
import { commandExists, ensureOutputDirectory, writeJson } from "./utils.js";
export const resolveProvider = async (requested) => {
    if (requested !== "auto")
        return requested;
    if (await commandExists("codex"))
        return "codex";
    if (await commandExists("claude"))
        return "claude";
    throw new Error("没有找到可用 Agent。请安装 codex/claude，或配置 agent.provider=custom");
};
const buildPrompt = (taskFile) => `你正在执行 Code Doctor 的单问题修复任务。

读取任务文件：${taskFile}

硬性要求：
1. 只修复任务中的一个诊断，不顺手重构其他代码。
2. 修改前先理解相关代码和现有测试。
3. 保持现有外部行为，除非诊断明确说明该行为错误。
4. 尽可能增加或更新聚焦的回归测试。
5. 执行任务列出的验证命令。
6. 不创建提交、不推送分支、不创建 MR，这些由 Code Doctor 处理。
7. 如果无法安全证明修复正确，不要猜测；保持工作区不变并说明原因。
8. 不修改任务范围之外的配置、依赖版本、数据库迁移或公共 API。

最终简要说明根因、修改内容和验证结果。`;
const shellQuote = (value) => `'${value.replaceAll("'", `'"'"'`)}'`;
export const createRepairTask = async (input) => {
    const task = {
        schemaVersion: 1,
        diagnostic: input.diagnostic,
        constraints: {
            maxChangedFiles: input.maxChangedFiles,
            maxChangedLines: input.maxChangedLines,
            mustAddOrUpdateTests: true,
            forbiddenActions: [
                "提交或推送 Git 变更",
                "创建或修改数据库迁移",
                "修改密钥和部署凭证",
                "扩大到其他诊断或架构重构",
            ],
        },
        verificationCommands: input.verificationCommands,
    };
    const directory = path.join(input.root, ".code-doctor");
    await fs.mkdir(directory, { recursive: true });
    const taskFile = path.join(directory, "task.json");
    const promptFile = path.join(directory, "prompt.md");
    await writeJson(taskFile, task);
    await fs.writeFile(promptFile, `${buildPrompt(taskFile)}\n`, "utf8");
    return { task, taskFile, promptFile };
};
export const runConfiguredAgent = async (input) => {
    const provider = await resolveProvider(input.config.provider);
    let command;
    if (provider === "codex") {
        command = `codex exec --sandbox workspace-write --json "$(cat ${shellQuote(input.promptFile)})"`;
    }
    else if (provider === "claude") {
        command = `claude --bare -p "$(cat ${shellQuote(input.promptFile)})" --permission-mode acceptEdits --output-format stream-json --verbose`;
    }
    else {
        if (!input.config.command)
            throw new Error("自定义 Agent 必须配置 agent.command");
        command = input.config.command
            .replaceAll("{promptFile}", shellQuote(input.promptFile))
            .replaceAll("{root}", shellQuote(input.root));
    }
    const result = await runCommand({
        command,
        cwd: input.root,
        timeoutMs: input.config.timeoutMs,
        env: {
            CODE_DOCTOR_PROMPT_FILE: input.promptFile,
            CODE_DOCTOR_ROOT: input.root,
        },
    });
    const output = await ensureOutputDirectory(input.root);
    const prefix = input.artifactPrefix ? `${input.artifactPrefix}-` : "";
    await fs.writeFile(path.join(output, `${prefix}agent-stdout.jsonl`), result.stdout, "utf8");
    await fs.writeFile(path.join(output, `${prefix}agent-stderr.log`), result.stderr, "utf8");
    return {
        provider,
        command,
        exitCode: result.exitCode,
        durationMs: result.durationMs,
        stdout: result.stdout,
        stderr: result.stderr,
    };
};
export const runRepairAgent = async (input) => runConfiguredAgent(input);
//# sourceMappingURL=agent.js.map