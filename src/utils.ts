import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export const makeRunId = (): string => {
  const timestamp = new Date().toISOString().replaceAll(/[-:.TZ]/g, "").slice(0, 14);
  return `${timestamp}-${crypto.randomBytes(3).toString("hex")}`;
};

export const stableId = (...parts: Array<string | number | undefined>): string =>
  crypto
    .createHash("sha256")
    .update(parts.filter((part) => part !== undefined).join("\u0000"))
    .digest("hex")
    .slice(0, 20);

export const ensureOutputDirectory = async (root: string): Promise<string> => {
  const directory = path.join(root, ".code-doctor", "output");
  await fs.mkdir(directory, { recursive: true });
  return directory;
};

export const writeJson = async (file: string, value: unknown): Promise<void> => {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
};

export const normalizePath = (root: string, file: string): string =>
  path.relative(root, path.resolve(root, file)).split(path.sep).join("/");

export const pathExists = async (file: string): Promise<boolean> => {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
};

export const commandExists = async (command: string): Promise<boolean> => {
  const { spawn } = await import("node:child_process");
  return new Promise((resolve) => {
    const child = spawn("sh", ["-lc", `command -v ${JSON.stringify(command)}`], {
      stdio: "ignore",
    });
    child.on("close", (code) => resolve(code === 0));
    child.on("error", () => resolve(false));
  });
};
