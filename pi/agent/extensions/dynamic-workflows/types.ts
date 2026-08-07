import type { Usage } from "@earendil-works/pi-ai";
import type { DynamicWorkflowAgentStatus, DynamicWorkflowStatus } from "../../lib/dynamic-workflow-events.ts";

export type AgentStatus = DynamicWorkflowAgentStatus;
export type WorkflowStatus = DynamicWorkflowStatus;

export interface RoleDefinition {
  name: string;
  description: string;
  model: string;
  thinking?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
  tools: string[];
  skills: string[];
  prompt: string;
  filePath: string;
}

export interface WorkflowAgentDefinition {
  id: string;
  role: string;
  prompt: string;
  dependsOn: string[];
  /** Worktree-relative text files explicitly approved as bounded agent context. */
  contextFiles?: string[];
  tools?: string[];
  skills?: string[];
}

export interface WorkflowDefinition {
  name: string;
  description?: string;
  agents: WorkflowAgentDefinition[];
}

export interface ResolvedContextFile {
  /** Canonical, worktree-relative path used in the context heading. */
  path: string;
  absolutePath: string;
  bytes: number;
  content: string;
}

export interface AgentContextBundle {
  files: ResolvedContextFile[];
  totalBytes: number;
  /** Ready-to-append bounded context with untrusted-content/soft-scope guidance. */
  text: string;
}

export interface ResolvedAgentDefinition extends WorkflowAgentDefinition {
  resolvedRole: RoleDefinition;
  effectiveTools: string[];
  effectiveSkills: string[];
  contextBundle?: AgentContextBundle;
}

export interface ResolvedWorkflow {
  source: string;
  definition: WorkflowDefinition;
  agents: ResolvedAgentDefinition[];
  waves: string[][];
}

export interface PermissionDecisionRecord {
  at: number;
  agentId: string;
  command: string;
  source: "cc-safety-net";
  action: "allow" | "deny";
  reason: string;
  segment?: string;
  overridden?: boolean;
}

export interface AgentSessionMetadata {
  /** Persistent Pi session id, distinct from the workflow and parent session ids. */
  sessionId: string;
  /** Persistent session artifact, when the backend has one. */
  sessionFile?: string;
}

export interface AgentBackendIdentity {
  kind: "pi" | "zmx";
  provider?: string;
  model?: string;
  /** Stable zmx identity used to open/control a zmx-backed agent. */
  zmxSessionId?: string;
}

/** Legacy aggregate written before complete pi-ai Usage was retained. */
export interface LegacyAgentUsage {
  input: number;
  output: number;
  cost: number;
}

export type AgentRunUsage = Usage | LegacyAgentUsage;

export interface AgentRunRecord {
  id: string;
  role: string;
  prompt: string;
  status: AgentStatus;
  model: string;
  tools: string[];
  skills: string[];
  startedAt?: number;
  finishedAt?: number;
  activity?: string;
  /** Coarse, non-sensitive activity label safe for in-process sidebar events. */
  sidebarActivity?: string;
  /** Final assistant summary; this is the value carried by {{agents.ID.output}}. */
  finalSummary?: string;
  session?: AgentSessionMetadata;
  backend?: AgentBackendIdentity;
  /** Complete pi-ai Usage for new records; legacy aggregates remain readable. */
  usage?: AgentRunUsage;
  /** @deprecated Legacy persisted name for finalSummary. */
  output?: string;
  error?: string;
}

export interface WorkflowRun {
  runId: string;
  sessionId: string;
  name: string;
  description?: string;
  cwd: string;
  status: WorkflowStatus;
  approvedSource: string;
  waves: string[][];
  agents: AgentRunRecord[];
  permissionDecisions: PermissionDecisionRecord[];
  startedAt: number;
  finishedAt?: number;
  error?: string;
}
