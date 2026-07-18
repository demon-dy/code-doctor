export type Severity = "error" | "warning" | "info";

export interface SourceLocation {
  file: string;
  line?: number;
  column?: number;
}

export interface Diagnostic {
  id: string;
  scanner: string;
  rule: string;
  severity: Severity;
  message: string;
  location: SourceLocation;
  snippet?: string;
  help?: string;
  fixable: boolean;
  metadata?: Record<string, unknown>;
}

export interface ScannerConfig {
  name: string;
  command: string;
  parser: "auto" | "eslint" | "react-doctor" | "sarif" | "tsc" | "go" | "generic";
  enabled?: boolean;
  timeoutMs?: number;
}

export interface AgentConfig {
  provider: "auto" | "codex" | "claude" | "custom";
  command?: string;
  timeoutMs?: number;
}

export interface GraphConfig {
  enabled: boolean;
  include: string[];
  exclude: string[];
}

export interface GitLabConfig {
  enabled: boolean;
  remote: string;
  targetBranch: string;
  labels: string[];
}

export interface CodeDoctorConfig {
  version: 1;
  scanners: ScannerConfig[];
  agent: AgentConfig;
  verify: string[];
  graph: GraphConfig;
  gitlab: GitLabConfig;
  limits: {
    maxChangedFiles: number;
    maxChangedLines: number;
  };
  ignore: string[];
}

export interface ScanReport {
  schemaVersion: 1;
  runId: string;
  createdAt: string;
  root: string;
  diagnostics: Diagnostic[];
  scanners: Array<{
    name: string;
    command: string;
    exitCode: number;
    durationMs: number;
    diagnosticCount: number;
    error?: string;
  }>;
}

export type GraphNodeKind =
  | "file"
  | "function"
  | "frontend"
  | "endpoint"
  | "handler"
  | "external";

export interface GraphNode {
  id: string;
  label: string;
  kind: GraphNodeKind;
  language?: "typescript" | "javascript" | "go";
  location?: SourceLocation;
  metadata?: Record<string, unknown>;
}

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  kind: "import" | "call" | "http" | "route" | "matches";
  confidence: "confirmed" | "inferred";
  location?: SourceLocation;
}

export interface CodeGraph {
  schemaVersion: 1;
  createdAt: string;
  root: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: Record<string, number>;
}

export interface AgentRunResult {
  provider: string;
  command: string;
  exitCode: number;
  durationMs: number;
  stdout: string;
  stderr: string;
}

export interface DoctorRunRecord {
  schemaVersion: 1;
  runId: string;
  startedAt: string;
  finishedAt: string;
  selectedDiagnostic?: Diagnostic;
  beforeCount: number;
  afterCount?: number;
  resolved: boolean;
  verificationPassed: boolean;
  agent?: Omit<AgentRunResult, "stdout" | "stderr">;
  branch?: string;
  commit?: string;
  mergeRequestUrl?: string;
  error?: string;
}
