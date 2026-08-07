import type { RoleDefinition, WorkflowAgentDefinition, WorkflowDefinition } from "../types.ts";

/** A mutable, UI-only copy of a parsed workflow. */
export type WorkflowDraft = WorkflowDefinition;
export type WorkflowAgentDraft = WorkflowAgentDefinition;

export interface WorkflowMetadataPatch {
  name?: string;
  description?: string;
}

export interface DraftValidationIssue {
  /** Stable form path, for example `agents[1].dependsOn`. */
  path: string;
  message: string;
}

export interface DraftValidationResult {
  valid: boolean;
  issues: DraftValidationIssue[];
}

export type RoleCatalog = ReadonlyMap<string, RoleDefinition>;
