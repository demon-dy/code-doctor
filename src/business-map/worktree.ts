import { runCommand } from "../process.js";

export const captureBusinessSourceState = async (root: string): Promise<string | undefined> => {
  const result = await runCommand({ command: "git status --porcelain=v1 --untracked-files=all", cwd: root });
  if (result.exitCode !== 0) return undefined;
  return result.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((line) => {
      const file = line.slice(3).replace(/^"|"$/g, "");
      return file !== ".code-doctor" && !file.startsWith(".code-doctor/");
    })
    .sort()
    .join("\n");
};

export const assertBusinessSourceUnchanged = async (root: string, before?: string): Promise<void> => {
  if (before === undefined) return;
  const after = await captureBusinessSourceState(root);
  if (after !== before) throw new Error("业务审计 Agent 修改了项目源码或 Git 状态，已拒绝本次产物；请人工恢复这些变更");
};
