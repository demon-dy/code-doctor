import fs from "node:fs/promises";
import path from "node:path";
import type { Diagnostic, Severity } from "../types.js";
import { normalizePath, stableId } from "../utils.js";

interface RawFinding {
  scanner: string;
  rule: string;
  severity: Severity;
  message: string;
  file: string;
  line?: number;
  column?: number;
  snippet?: string;
  help?: string;
  fixable?: boolean;
  metadata?: Record<string, unknown>;
}

const readSnippet = async (
  root: string,
  file: string,
  line?: number,
): Promise<string | undefined> => {
  if (!line || line < 1) return undefined;
  try {
    const content = await fs.readFile(path.resolve(root, file), "utf8");
    return content.split(/\r?\n/)[line - 1]?.trim().replaceAll(/\s+/g, " ").slice(0, 240);
  } catch {
    return undefined;
  }
};

const toDiagnostic = async (root: string, finding: RawFinding): Promise<Diagnostic> => {
  const file = normalizePath(root, finding.file);
  const snippet = finding.snippet ?? (await readSnippet(root, file, finding.line));
  return {
    id: stableId(finding.scanner, finding.rule, file, snippet ?? finding.message),
    scanner: finding.scanner,
    rule: finding.rule,
    severity: finding.severity,
    message: finding.message,
    location: { file, line: finding.line, column: finding.column },
    snippet,
    help: finding.help,
    fixable: finding.fixable ?? true,
    metadata: finding.metadata,
  };
};

const normalizeSeverity = (value: unknown): Severity => {
  if (value === 2 || value === "2" || value === "error" || value === "critical") {
    return "error";
  }
  if (value === 1 || value === "1" || value === "warning" || value === "warn") {
    return "warning";
  }
  return "info";
};

const parseJson = (output: string): unknown => {
  const trimmed = output.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    const firstObject = trimmed.indexOf("{");
    const firstArray = trimmed.indexOf("[");
    const startCandidates = [firstObject, firstArray].filter((index) => index >= 0);
    const start = Math.min(...startCandidates);
    if (!Number.isFinite(start)) throw new Error("输出中没有 JSON");
    return JSON.parse(trimmed.slice(start));
  }
};

const parseEslint = (value: unknown, scanner: string): RawFinding[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const record = entry as Record<string, unknown>;
    const file = String(record.filePath ?? "unknown");
    const messages = Array.isArray(record.messages) ? record.messages : [];
    return messages.flatMap((message) => {
      if (!message || typeof message !== "object") return [];
      const item = message as Record<string, unknown>;
      return [{
        scanner,
        rule: String(item.ruleId ?? "eslint"),
        severity: normalizeSeverity(item.severity),
        message: String(item.message ?? "ESLint diagnostic"),
        file,
        line: Number(item.line) || undefined,
        column: Number(item.column) || undefined,
        fixable: Boolean(item.fix),
      } satisfies RawFinding];
    });
  });
};

const parseReactDoctor = (value: unknown, scanner: string): RawFinding[] => {
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  const diagnostics = Array.isArray(record.diagnostics)
    ? record.diagnostics
    : Array.isArray(record.projects)
      ? (record.projects as Array<Record<string, unknown>>).flatMap((project) =>
          Array.isArray(project.diagnostics) ? project.diagnostics : [],
        )
      : [];
  return diagnostics.flatMap((diagnostic) => {
    if (!diagnostic || typeof diagnostic !== "object") return [];
    const item = diagnostic as Record<string, unknown>;
    return [{
      scanner,
      rule: `${String(item.plugin ?? "react-doctor")}/${String(item.rule ?? "unknown")}`,
      severity: normalizeSeverity(item.severity),
      message: String(item.message ?? "React Doctor diagnostic"),
      file: String(item.filePath ?? item.normalizedFilePath ?? "unknown"),
      line: Number(item.line) || undefined,
      column: Number(item.column) || undefined,
      help: typeof item.help === "string" ? item.help : undefined,
      fixable: true,
      metadata: { category: item.category, tags: item.tags },
    } satisfies RawFinding];
  });
};

const parseSarif = (value: unknown, scanner: string): RawFinding[] => {
  if (!value || typeof value !== "object") return [];
  const runs = Array.isArray((value as Record<string, unknown>).runs)
    ? ((value as Record<string, unknown>).runs as Array<Record<string, unknown>>)
    : [];
  return runs.flatMap((run) => {
    const results = Array.isArray(run.results) ? run.results : [];
    return results.flatMap((result) => {
      if (!result || typeof result !== "object") return [];
      const item = result as Record<string, unknown>;
      const locations = Array.isArray(item.locations) ? item.locations : [];
      const physical = ((locations[0] as Record<string, unknown> | undefined)?.physicalLocation ?? {}) as Record<string, unknown>;
      const artifact = (physical.artifactLocation ?? {}) as Record<string, unknown>;
      const region = (physical.region ?? {}) as Record<string, unknown>;
      const message = (item.message ?? {}) as Record<string, unknown>;
      return [{
        scanner,
        rule: String(item.ruleId ?? "sarif"),
        severity: normalizeSeverity(item.level),
        message: String(message.text ?? "SARIF diagnostic"),
        file: String(artifact.uri ?? "unknown"),
        line: Number(region.startLine) || undefined,
        column: Number(region.startColumn) || undefined,
        fixable: true,
      } satisfies RawFinding];
    });
  });
};

const parseTypeScript = (output: string, scanner: string): RawFinding[] => {
  const pattern = /^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s+(.+)$/gm;
  return [...output.matchAll(pattern)].map((match) => ({
    scanner,
    file: match[1]!,
    line: Number(match[2]),
    column: Number(match[3]),
    severity: normalizeSeverity(match[4]),
    rule: match[5]!,
    message: match[6]!,
    fixable: true,
  }));
};

const parseGo = (output: string, scanner: string): RawFinding[] => {
  const pattern = /^(.+?\.go):(\d+)(?::(\d+))?:\s+(.+)$/gm;
  return [...output.matchAll(pattern)].map((match) => {
    const message = match[4]!;
    const ruleMatch = message.match(/\(([\w.-]+)\)$/);
    return {
      scanner,
      file: match[1]!,
      line: Number(match[2]),
      column: match[3] ? Number(match[3]) : undefined,
      severity: "warning",
      rule: ruleMatch?.[1] ?? scanner,
      message,
      fixable: true,
    };
  });
};

const parseGeneric = (value: unknown, scanner: string): RawFinding[] => {
  const items = Array.isArray(value)
    ? value
    : value && typeof value === "object" && Array.isArray((value as Record<string, unknown>).diagnostics)
      ? (value as Record<string, unknown>).diagnostics as unknown[]
      : [];
  return items.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const item = entry as Record<string, unknown>;
    const location = (item.location ?? {}) as Record<string, unknown>;
    return [{
      scanner: String(item.scanner ?? scanner),
      rule: String(item.rule ?? "generic"),
      severity: normalizeSeverity(item.severity),
      message: String(item.message ?? "Diagnostic"),
      file: String(item.file ?? location.file ?? "unknown"),
      line: Number(item.line ?? location.line) || undefined,
      column: Number(item.column ?? location.column) || undefined,
      help: typeof item.help === "string" ? item.help : undefined,
      fixable: item.fixable === undefined ? true : Boolean(item.fixable),
    } satisfies RawFinding];
  });
};

export const parseDiagnostics = async (input: {
  root: string;
  scanner: string;
  parser: "auto" | "eslint" | "react-doctor" | "sarif" | "tsc" | "go" | "generic";
  stdout: string;
  stderr: string;
}): Promise<Diagnostic[]> => {
  const output = `${input.stdout}\n${input.stderr}`;
  let raw: RawFinding[] = [];
  if (input.parser === "tsc") raw = parseTypeScript(output, input.scanner);
  else if (input.parser === "go") raw = parseGo(output, input.scanner);
  else {
    const value = parseJson(input.stdout || input.stderr);
    if (input.parser === "eslint") raw = parseEslint(value, input.scanner);
    else if (input.parser === "react-doctor") raw = parseReactDoctor(value, input.scanner);
    else if (input.parser === "sarif") raw = parseSarif(value, input.scanner);
    else raw = parseGeneric(value, input.scanner);
  }
  return Promise.all(raw.map((finding) => toDiagnostic(input.root, finding)));
};
