import type { DynamicWorkflowAgentStatus, DynamicWorkflowStatus } from "../../lib/dynamic-workflow-events.ts";

export type PermissionAction = "allow" | "ask" | "deny";
export type AgentStatus = DynamicWorkflowAgentStatus;
export type WorkflowStatus = DynamicWorkflowStatus;

export interface CommandPermissions {
  commands: Record<string, PermissionAction>;
}

export interface RoleDefinition {
  name: string;
  description: string;
  model: string;
  thinking?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
  tools: string[];
  skills: string[];
  permissions: CommandPermissions;
  prompt: string;
  filePath: string;
}

export interface WorkflowAgentDefinition {
  id: string;
  role: string;
  prompt: string;
  dependsOn: string[];
  tools?: string[];
  skills?: string[];
  permissions?: Partial<CommandPermissions>;
}

export interface WorkflowDefinition {
  name: string;
  description?: string;
  agents: WorkflowAgentDefinition[];
}

export interface ResolvedAgentDefinition extends WorkflowAgentDefinition {
  resolvedRole: RoleDefinition;
  effectiveTools: string[];
  effectiveSkills: string[];
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
  source: "workflow-policy" | "cc-safety-net";
  action: PermissionAction;
  reason: string;
  segment?: string;
  overridden?: boolean;
}

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
  output?: string;
  error?: string;
  usage?: { input: number; output: number; cost: number };
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
