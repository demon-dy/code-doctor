import { runCommand } from "./process.js";
const quote = (value) => `'${value.replaceAll("'", `'"'"'`)}'`;
export const assertCleanWorktree = async (root) => {
    const result = await runCommand({ command: "git status --porcelain", cwd: root });
    if (result.exitCode !== 0)
        throw new Error("当前目录不是可用的 Git 仓库");
    if (result.stdout.trim())
        throw new Error("工作区存在未提交修改，Code Doctor 不会覆盖用户工作");
};
export const currentBranch = async (root) => {
    const result = await runCommand({ command: "git branch --show-current", cwd: root });
    if (result.exitCode !== 0 || !result.stdout.trim())
        throw new Error("无法读取当前 Git 分支");
    return result.stdout.trim();
};
export const createDoctorBranch = async (root, diagnostic) => {
    const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
    const safeRule = diagnostic.rule.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replaceAll(/^-|-$/g, "").slice(0, 36);
    const branch = `code-doctor/${date}-${safeRule || diagnostic.id.slice(0, 8)}`;
    const result = await runCommand({ command: `git switch -c ${quote(branch)}`, cwd: root });
    if (result.exitCode !== 0)
        throw new Error(`创建分支失败：${result.stderr || result.stdout}`);
    return branch;
};
export const changedStats = async (root) => {
    const result = await runCommand({ command: "git diff --numstat", cwd: root });
    const rows = result.stdout.trim() ? result.stdout.trim().split("\n") : [];
    return rows.reduce((total, row) => {
        const [added, deleted] = row.split("\t");
        return {
            files: total.files + 1,
            added: total.added + (Number(added) || 0),
            deleted: total.deleted + (Number(deleted) || 0),
        };
    }, { files: 0, added: 0, deleted: 0 });
};
export const commitDoctorFix = async (input) => {
    const add = await runCommand({ command: "git add -A", cwd: input.root });
    if (add.exitCode !== 0)
        throw new Error(`暂存修改失败：${add.stderr}`);
    const message = `fix: 修复 ${input.diagnostic.rule}`;
    const commit = await runCommand({
        command: `git commit -m ${quote(message)}`,
        cwd: input.root,
    });
    if (commit.exitCode !== 0)
        throw new Error(`创建提交失败：${commit.stderr || commit.stdout}`);
    const sha = await runCommand({ command: "git rev-parse HEAD", cwd: input.root });
    return sha.stdout.trim();
};
export const pushAndCreateMergeRequest = async (input) => {
    const push = await runCommand({
        command: `git push -u ${quote(input.config.gitlab.remote)} ${quote(input.branch)}`,
        cwd: input.root,
        timeoutMs: 300_000,
    });
    if (push.exitCode !== 0)
        throw new Error(`推送分支失败：${push.stderr || push.stdout}`);
    const title = `Code Doctor：修复 ${input.diagnostic.rule}`;
    const description = `## 今日修复\n\n${input.diagnostic.message}\n\n## 证据\n\n- 扫描器：${input.diagnostic.scanner}\n- 规则：${input.diagnostic.rule}\n- 位置：${input.diagnostic.location.file}:${input.diagnostic.location.line ?? "?"}\n- 诊断 ID：\`${input.diagnostic.id}\`\n\n## 验证\n\nCode Doctor 已重新扫描并执行项目验证命令。详细日志见本次 Pipeline Artifact 的 \`.code-doctor/output/\`。\n\n> 此 MR 由 Code Doctor 自动创建，必须由人类审核后合并。`;
    const labels = input.config.gitlab.labels.flatMap((label) => ["--label", quote(label)]).join(" ");
    const mr = await runCommand({
        command: `glab mr create --yes --source-branch ${quote(input.branch)} --target-branch ${quote(input.config.gitlab.targetBranch)} --title ${quote(title)} --description ${quote(description)} ${labels}`,
        cwd: input.root,
        timeoutMs: 120_000,
    });
    if (mr.exitCode !== 0)
        throw new Error(`创建 MR 失败：${mr.stderr || mr.stdout}`);
    const url = `${mr.stdout}\n${mr.stderr}`.match(/https?:\/\/\S+\/merge_requests\/\d+/)?.[0];
    return url ?? mr.stdout.trim();
};
export const restoreBranch = async (root, branch) => {
    await runCommand({ command: `git switch ${quote(branch)}`, cwd: root });
};
//# sourceMappingURL=git.js.map