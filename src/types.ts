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

export interface BusinessMapConfig {
  enabled: boolean;
  maxNodes: number;
  maxEvidence: number;
}

export interface AuditConfig {
  maxScenariosPerRun: number;
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
  businessMap: BusinessMapConfig;
  audit: AuditConfig;
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

export type BusinessNodeKind =
  | "scenario"
  | "actor"
  | "state"
  | "decision"
  | "action"
  | "outcome"
  | "side_effect"
  | "system";

export type KnowledgeStatus = "fact" | "inference" | "confirmed" | "unknown" | "conflicted";
export type EvidenceKind = "source" | "test" | "git" | "runtime" | "human" | "agent";

export interface BusinessEvidence {
  id: string;
  kind: EvidenceKind;
  description: string;
  location?: SourceLocation;
  reference?: string;
  confidence: number;
}

export interface BusinessNode {
  id: string;
  label: string;
  kind: BusinessNodeKind;
  summary: string;
  status: KnowledgeStatus;
  evidenceIds: string[];
}

export interface BusinessEdge {
  id: string;
  from: string;
  to: string;
  label?: string;
  guard?: string;
  status: KnowledgeStatus;
  confidence: number;
  evidenceIds: string[];
}

export interface BusinessChapter {
  id: string;
  title: string;
  summary: string;
  nodeIds: string[];
}

export interface BusinessMap {
  schemaVersion: 1;
  createdAt: string;
  root: string;
  title: string;
  focus: string;
  summary: string;
  chapters: BusinessChapter[];
  nodes: BusinessNode[];
  edges: BusinessEdge[];
  evidence: BusinessEvidence[];
  uncertainties: string[];
  agent?: {
    provider: string;
    durationMs: number;
  };
}

export interface BusinessExpectation {
  raw: string;
  interpretation: string;
  actors: string[];
  preconditions: string[];
  expectedOutcomes: string[];
  assumptions: string[];
}

export type FindingStatus = "satisfied" | "violated" | "uncertain";

export interface BusinessFinding {
  id: string;
  status: FindingStatus;
  severity: Severity;
  title: string;
  conclusion: string;
  reasoning: string[];
  relatedNodeIds: string[];
  evidenceIds: string[];
  confidence: number;
  recommendation?: string;
}

export interface BusinessAuditReport {
  schemaVersion: 1;
  runId: string;
  createdAt: string;
  root: string;
  mapCreatedAt: string;
  expectation: BusinessExpectation;
  conclusion: string;
  findings: BusinessFinding[];
  unansweredQuestions: string[];
  agent?: {
    provider: string;
    durationMs: number;
  };
}

export type KnowledgeStatusValue = "candidate" | "reviewed";

export interface KnowledgeScenarioRecord {
  schemaVersion: 1;
  id: string;
  title: string;
  focus: string;
  status: KnowledgeStatusValue;
  createdAt: string;
  updatedAt: string;
  sourceCommit?: string;
  reviewedBy?: string;
  reviewedAt?: string;
  map: BusinessMap;
}

export interface KnowledgeAtlasEntry {
  id: string;
  title: string;
  focus: string;
  status: KnowledgeStatusValue;
  updatedAt: string;
  candidateAvailable?: boolean;
  summary?: string;
  priority?: "critical" | "high" | "normal";
  dependsOn?: string[];
  evidenceFiles?: string[];
}

export interface KnowledgeAtlas {
  schemaVersion: 1;
  updatedAt: string;
  scenarios: KnowledgeAtlasEntry[];
}

export type ProjectScenarioState = "unmapped" | "mapped" | "reviewed" | "pending_review";
export type ProjectScenarioFreshness = "current" | "stale" | "unknown";
export type ProjectBuildScenarioStatus = "pending" | "running" | "completed" | "failed";

export interface ProjectBuildScenarioRun {
  id: string;
  title: string;
  focus: string;
  status: ProjectBuildScenarioStatus;
  attempts: number;
  startedAt?: string;
  completedAt?: string;
  failedAt?: string;
  error?: string;
}

export interface ProjectBuildRunState {
  schemaVersion: 1;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  status: "running" | "completed" | "completed_with_failures" | "partial";
  discoveryPerformed: boolean;
  scenarios: ProjectBuildScenarioRun[];
}

export interface ProjectReportScenario {
  id: string;
  title: string;
  focus: string;
  summary?: string;
  priority: "critical" | "high" | "normal";
  dependsOn: string[];
  evidenceFiles: string[];
  missingEvidenceFiles: string[];
  state: ProjectScenarioState;
  freshness: ProjectScenarioFreshness;
  buildStatus?: ProjectBuildScenarioStatus;
  buildError?: string;
  updatedAt: string;
  sourceCommit?: string;
  changedEvidenceFiles: string[];
  map?: BusinessMap;
}

export interface ProjectBusinessReport {
  schemaVersion: 1;
  createdAt: string;
  root: string;
  project: {
    name: string;
    summary: string;
    summaryStatus: "empty" | "candidate" | "confirmed";
  };
  atlasUpdatedAt?: string;
  sourceCommit?: string;
  scenarios: ProjectReportScenario[];
  coverage: {
    discovered: number;
    mapped: number;
    reviewed: number;
    pendingReview: number;
    stale: number;
    buildPending: number;
    buildFailed: number;
    evidenceFiles: number;
    existingEvidenceFiles: number;
    mapPercent: number;
    reviewPercent: number;
  };
  unknownBoundaries: string[];
  audit?: ProjectAuditReport;
  impact?: ProjectImpactReport;
}

export type ProjectImpactChangeStatus = "added" | "modified" | "deleted" | "renamed" | "copied" | "type_changed" | "unmerged" | "unknown";
export type ProjectImpactBuildStatus = "pending" | "running" | "completed" | "failed" | "skipped_no_agent";

export interface ProjectImpactChangedFile {
  path: string;
  previousPath?: string;
  status: ProjectImpactChangeStatus;
  businessSource: boolean;
  global: boolean;
  scenarioIds: string[];
}

export interface ProjectImpactScenario {
  id: string;
  title: string;
  focus: string;
  matchedFiles: string[];
  status: ProjectImpactBuildStatus;
  attempts: number;
  startedAt?: string;
  completedAt?: string;
  failedAt?: string;
  error?: string;
}

export interface ProjectImpactReport {
  schemaVersion: 1;
  createdAt: string;
  updatedAt: string;
  root: string;
  range: string;
  sourceCommit?: string;
  status: "running" | "partial" | "partial_with_failures" | "completed" | "completed_with_failures";
  useAgent: boolean;
  limit?: number;
  changedFiles: ProjectImpactChangedFile[];
  impactedScenarios: ProjectImpactScenario[];
  unchangedScenarioIds: string[];
  unattributedFiles: string[];
  unknownBoundaries: string[];
  audit: {
    status: "pending" | "completed" | "failed";
    sourceCommit?: string;
    agentStatus?: ProjectAuditReport["agent"]["status"];
    error?: string;
  };
}

export type ProjectAuditFindingSource = "structure" | "agent";
export type ProjectAuditFindingStatus = "risk" | "uncertain";
export type ProjectAuditCategory =
  | "missing_entry"
  | "missing_outcome"
  | "dead_end"
  | "decision_branch"
  | "unreachable"
  | "guard_conflict"
  | "evidence_gap"
  | "evidence_conflict"
  | "unreachable_business_outcome"
  | "condition_coverage"
  | "state_transition"
  | "cross_scenario_conflict"
  | "missing_side_effect"
  | "other_business_logic";

export interface ProjectAuditNodeReference {
  scenarioId: string;
  nodeId: string;
}

export interface ProjectAuditEvidenceReference {
  scenarioId: string;
  evidenceId: string;
}

export interface ProjectAuditFinding {
  id: string;
  source: ProjectAuditFindingSource;
  category: ProjectAuditCategory;
  status: ProjectAuditFindingStatus;
  severity: Severity;
  title: string;
  conclusion: string;
  reasoning: string[];
  relatedScenarioIds: string[];
  relatedNodes: ProjectAuditNodeReference[];
  evidence: ProjectAuditEvidenceReference[];
  confidence: number;
  recommendation?: string;
}

export interface ProjectAuditReport {
  schemaVersion: 1;
  createdAt: string;
  root: string;
  sourceCommit?: string;
  mappedScenarioCount: number;
  discoveredScenarioCount: number;
  auditedScenarios: Array<{
    id: string;
    mapCreatedAt: string;
    freshness: ProjectScenarioFreshness;
  }>;
  findings: ProjectAuditFinding[];
  summary: {
    risk: number;
    uncertain: number;
    error: number;
    warning: number;
    structure: number;
    agent: number;
  };
  agent: {
    status: "completed" | "skipped" | "failed";
    provider?: string;
    durationMs?: number;
    conclusion?: string;
    unansweredQuestions?: string[];
    error?: string;
  };
  boundaries: string[];
}

export interface KnowledgeRule {
  id: string;
  scenarioId: string;
  statement: string;
  status: "confirmed";
  confirmedBy: string;
  confirmedAt: string;
  updatedAt: string;
}

export type TakeoverScenarioStatus = "unstarted" | "in_progress" | "understood";

export interface TakeoverState {
  schemaVersion: 1;
  startedAt?: string;
  updatedAt: string;
  owner?: string;
  scenarios: Array<{
    id: string;
    title: string;
    status: TakeoverScenarioStatus;
    confirmedBy?: string;
    confirmedAt?: string;
  }>;
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
