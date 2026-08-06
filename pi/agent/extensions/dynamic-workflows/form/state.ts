import { isAbsolute } from "node:path";
import type { PermissionAction, WorkflowAgentDefinition, WorkflowDefinition } from "../types.ts";
import {
  AGENT_ID_PATTERN,
  MAX_CONTEXT_FILE_PATH_BYTES,
  MAX_CONTEXT_FILES_PER_AGENT,
  agentOutputReferences,
  invalidAgentOutputPlaceholder,
  parseWorkflow,
  workflowWaves,
} from "../workflow.ts";
import type {
  DraftValidationIssue,
  DraftValidationResult,
  RoleCatalog,
  WorkflowAgentDraft,
  WorkflowDraft,
  WorkflowMetadataPatch,
} from "./types.ts";

const MAX_AGENTS = 32;
const ACTIONS = new Set<PermissionAction>(["allow", "ask", "deny"]);
function cloneAgent(agent: WorkflowAgentDefinition): WorkflowAgentDraft {
  return {
    id: agent.id,
    role: agent.role,
    prompt: agent.prompt,
    dependsOn: [...agent.dependsOn],
    ...(agent.contextFiles === undefined ? {} : { contextFiles: [...agent.contextFiles] }),
    ...(agent.tools === undefined ? {} : { tools: [...agent.tools] }),
    ...(agent.skills === undefined ? {} : { skills: [...agent.skills] }),
    ...(agent.permissions === undefined ? {} : {
      permissions: {
        ...(agent.permissions.commands === undefined ? {} : { commands: { ...agent.permissions.commands } }),
      },
    }),
  };
}

/** Deep-copy a parsed definition so form edits never mutate the approved plan. */
export function createWorkflowDraft(definition: WorkflowDefinition = { name: "", agents: [] }): WorkflowDraft {
  return {
    name: definition.name,
    ...(definition.description === undefined ? {} : { description: definition.description }),
    agents: definition.agents.map(cloneAgent),
  };
}

export const draftFromWorkflow = createWorkflowDraft;

export function parseWorkflowDraft(source: string): WorkflowDraft {
  return createWorkflowDraft(parseWorkflow(source));
}

/** Mutate only the supplied metadata fields. An empty description clears it. */
export function updateWorkflowMetadata(draft: WorkflowDraft, patch: WorkflowMetadataPatch): void {
  if (patch.name !== undefined) draft.name = patch.name;
  if (patch.description !== undefined) {
    if (patch.description) draft.description = patch.description;
    else delete draft.description;
  }
}

export const setWorkflowMetadata = updateWorkflowMetadata;

function nextAgentId(draft: WorkflowDraft): string {
  const ids = new Set(draft.agents.map((agent) => agent.id));
  for (let number = 1; ; number++) {
    const id = `agent-${number}`;
    if (!ids.has(id)) return id;
  }
}

/** Add an independently owned agent object and return the inserted draft agent. */
export function addAgent(
  draft: WorkflowDraft,
  agent: Partial<WorkflowAgentDefinition> = {},
  index = draft.agents.length,
): WorkflowAgentDraft {
  if (!Number.isInteger(index) || index < 0 || index > draft.agents.length) throw new Error("Agent insertion index is out of range");
  const inserted = cloneAgent({
    id: agent.id ?? nextAgentId(draft),
    role: agent.role ?? "",
    prompt: agent.prompt ?? "",
    dependsOn: agent.dependsOn ?? [],
    ...(agent.contextFiles === undefined ? {} : { contextFiles: agent.contextFiles }),
    ...(agent.tools === undefined ? {} : { tools: agent.tools }),
    ...(agent.skills === undefined ? {} : { skills: agent.skills }),
    ...(agent.permissions === undefined ? {} : { permissions: agent.permissions }),
  });
  draft.agents.splice(index, 0, inserted);
  return inserted;
}

/** Delete an agent and remove its now-dangling dependency edges. */
export function deleteAgent(draft: WorkflowDraft, id: string): WorkflowAgentDraft | undefined {
  const index = draft.agents.findIndex((agent) => agent.id === id);
  if (index < 0) return undefined;
  const [deleted] = draft.agents.splice(index, 1);
  for (const agent of draft.agents) agent.dependsOn = agent.dependsOn.filter((dependency) => dependency !== id);
  return deleted;
}

/** Move an agent by id or current index. Agent order is significant for wave order. */
export function reorderAgent(draft: WorkflowDraft, agent: string | number, toIndex: number): boolean {
  const fromIndex = typeof agent === "number" ? agent : draft.agents.findIndex((item) => item.id === agent);
  if (!Number.isInteger(fromIndex) || fromIndex < 0 || fromIndex >= draft.agents.length) return false;
  if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex >= draft.agents.length) return false;
  if (fromIndex === toIndex) return true;
  const [moved] = draft.agents.splice(fromIndex, 1);
  draft.agents.splice(toIndex, 0, moved!);
  return true;
}

export const moveAgent = reorderAgent;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Rename an agent as one transaction: preconditions are checked before the id,
 * dependency edges, or output placeholders are changed.
 */
export function renameAgent(draft: WorkflowDraft, oldId: string, newId: string): WorkflowAgentDraft {
  const agent = draft.agents.find((item) => item.id === oldId);
  if (!agent) throw new Error(`Unknown agent ${oldId}`);
  if (!AGENT_ID_PATTERN.test(newId)) throw new Error(`Invalid agent id ${JSON.stringify(newId)}`);
  if (oldId !== newId && draft.agents.some((item) => item.id === newId)) throw new Error(`Duplicate agent id ${newId}`);
  if (oldId === newId) return agent;

  const placeholder = new RegExp(`\\{\\{agents\\.${escapeRegExp(oldId)}\\.output\\}\\}`, "g");
  agent.id = newId;
  for (const item of draft.agents) {
    item.dependsOn = item.dependsOn.map((dependency) => dependency === oldId ? newId : dependency);
    item.prompt = item.prompt.replace(placeholder, () => `{{agents.${newId}.output}}`);
  }
  return agent;
}

function issue(issues: DraftValidationIssue[], path: string, message: string): void {
  issues.push({ path, message });
}

function validateStringList(
  value: unknown,
  path: string,
  issues: DraftValidationIssue[],
  allowed?: readonly string[],
): void {
  if (!Array.isArray(value)) { issue(issues, path, "Must be an array"); return; }
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string" || !item.trim()) { issue(issues, path, "Must contain only non-empty strings"); continue; }
    if (item !== item.trim()) issue(issues, path, `Value ${JSON.stringify(item)} has surrounding whitespace`);
    if (seen.has(item)) issue(issues, path, `Contains duplicate value ${item}`);
    seen.add(item);
    if (allowed && !allowed.includes(item)) issue(issues, path, `Cannot add ${item}; it is not allowed by the role`);
  }
}

function transitivelyDependsOn(agent: WorkflowAgentDraft, target: string, byId: ReadonlyMap<string, WorkflowAgentDraft>): boolean {
  const pending = Array.isArray(agent.dependsOn) ? [...agent.dependsOn] : [];
  const visited = new Set<string>();
  while (pending.length) {
    const id = pending.pop()!;
    if (id === target) return true;
    if (visited.has(id)) continue;
    visited.add(id);
    const dependency = byId.get(id);
    if (dependency && Array.isArray(dependency.dependsOn)) pending.push(...dependency.dependsOn);
  }
  return false;
}

/** Validate a draft without changing it. All independently detectable issues are returned. */
export function validateWorkflowDraft(draft: WorkflowDraft, roles: RoleCatalog): DraftValidationResult {
  const issues: DraftValidationIssue[] = [];
  if (typeof draft.name !== "string" || !draft.name.trim()) issue(issues, "name", "Workflow name is required");
  if (draft.description !== undefined && typeof draft.description !== "string") issue(issues, "description", "Description must be a string");
  if (!Array.isArray(draft.agents) || draft.agents.length < 1 || draft.agents.length > MAX_AGENTS) {
    issue(issues, "agents", `Workflow must contain 1-${MAX_AGENTS} agents`);
  }

  const byId = new Map<string, WorkflowAgentDraft>();
  for (const [index, agent] of draft.agents.entries()) {
    const base = `agents[${index}]`;
    if (typeof agent.id !== "string" || !AGENT_ID_PATTERN.test(agent.id)) issue(issues, `${base}.id`, "Invalid agent id");
    else if (byId.has(agent.id)) issue(issues, `${base}.id`, `Duplicate agent id ${agent.id}`);
    else byId.set(agent.id, agent);
  }

  for (const [index, agent] of draft.agents.entries()) {
    const base = `agents[${index}]`;
    const role = roles.get(agent.role);
    if (typeof agent.role !== "string" || !agent.role.trim()) issue(issues, `${base}.role`, "Role is required");
    else if (!role) issue(issues, `${base}.role`, `Unknown role ${agent.role}`);
    if (typeof agent.prompt !== "string" || !agent.prompt.trim()) issue(issues, `${base}.prompt`, "Prompt is required");

    validateStringList(agent.dependsOn, `${base}.dependsOn`, issues);
    if (Array.isArray(agent.dependsOn)) {
      for (const dependency of agent.dependsOn) {
        if (dependency === agent.id) issue(issues, `${base}.dependsOn`, "An agent cannot depend on itself");
        else if (!byId.has(dependency)) issue(issues, `${base}.dependsOn`, `Unknown agent ${dependency}`);
      }
    }
    if (agent.contextFiles !== undefined) {
      validateStringList(agent.contextFiles, `${base}.contextFiles`, issues);
      if (agent.contextFiles.length > MAX_CONTEXT_FILES_PER_AGENT) {
        issue(issues, `${base}.contextFiles`, `Cannot contain more than ${MAX_CONTEXT_FILES_PER_AGENT} paths`);
      }
      for (const path of agent.contextFiles) {
        if (typeof path !== "string") continue;
        if (Buffer.byteLength(path, "utf8") > MAX_CONTEXT_FILE_PATH_BYTES) {
          issue(issues, `${base}.contextFiles`, `Path exceeds ${MAX_CONTEXT_FILE_PATH_BYTES} bytes`);
        }
        if (isAbsolute(path) || /^[A-Za-z]:[\\/]/.test(path) || /^\\\\/.test(path) || path.split(/[\\/]+/).includes("..")) {
          issue(issues, `${base}.contextFiles`, `Path must stay inside the workflow worktree: ${path}`);
        }
        if (/[\u0000-\u001f\u007f]/.test(path)) issue(issues, `${base}.contextFiles`, "Paths cannot contain control characters");
      }
    }
    if (agent.tools !== undefined) validateStringList(agent.tools, `${base}.tools`, issues, role?.tools);
    if (agent.skills !== undefined) validateStringList(agent.skills, `${base}.skills`, issues, role?.skills);

    if (agent.permissions !== undefined) {
      const commands = agent.permissions.commands;
      if (!commands || typeof commands !== "object" || Array.isArray(commands)) {
        issue(issues, `${base}.permissions.commands`, "Command rules are required when permissions are set");
      } else {
        if (!("*" in commands)) issue(issues, `${base}.permissions.commands`, "Command rules must define a \"*\" rule");
        for (const [pattern, action] of Object.entries(commands)) {
          if (!pattern.trim() || pattern !== pattern.trim()) issue(issues, `${base}.permissions.commands`, "Command patterns must be non-empty and trimmed");
          if (["__proto__", "constructor", "prototype"].includes(pattern)) issue(issues, `${base}.permissions.commands`, `Invalid command pattern ${pattern}`);
          if (!ACTIONS.has(action)) issue(issues, `${base}.permissions.commands.${pattern}`, "Action must be allow, ask, or deny");
        }
      }
    }

    if (typeof agent.prompt === "string") {
      const malformed = invalidAgentOutputPlaceholder(agent.prompt);
      if (malformed) issue(issues, `${base}.prompt`, `Invalid output placeholder ${malformed}`);
      for (const referencedId of agentOutputReferences(agent.prompt)) {
        if (!byId.has(referencedId)) issue(issues, `${base}.prompt`, `References output from unknown agent ${referencedId}`);
        else if (referencedId === agent.id || !transitivelyDependsOn(agent, referencedId, byId)) {
          issue(issues, `${base}.prompt`, `References output from ${referencedId} without depending on it`);
        }
      }
    }
  }

  try { workflowWaves(draft.agents); }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("cycle")) issue(issues, "agents", message);
  }
  return { valid: issues.length === 0, issues };
}

export const validateDraft = validateWorkflowDraft;
