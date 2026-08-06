import { parse } from "acorn";
import type { PermissionAction, ResolvedAgentDefinition, ResolvedWorkflow, RoleDefinition, WorkflowAgentDefinition, WorkflowDefinition } from "./types.ts";

const MAX_AGENTS = 32;
const MAX_SOURCE_BYTES = 256 * 1024;
const MAX_PROMPT_BYTES = 64 * 1024;
const ACTIONS = new Set(["allow", "ask", "deny"]);
export const AGENT_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const OUTPUT_REFERENCE_PATTERN = /\{\{agents\.([A-Za-z][A-Za-z0-9_-]{0,63})\.output\}\}/g;
const COMPLETE_OUTPUT_REFERENCE_PATTERN = /^\{\{agents\.([A-Za-z][A-Za-z0-9_-]{0,63})\.output\}\}$/;

function literal(node: any, depth = 0): unknown {
  if (depth > 20) throw new Error("Workflow definition is nested too deeply");
  if (node?.type === "Literal") {
    if (node.value === null || ["string", "number", "boolean"].includes(typeof node.value)) return node.value;
    throw new Error("Workflow definition contains an unsupported literal");
  }
  if (node?.type === "ArrayExpression") {
    return node.elements.map((item: any) => {
      if (!item || item.type === "SpreadElement") throw new Error("Workflow arrays cannot contain holes or spreads");
      return literal(item, depth + 1);
    });
  }
  if (node?.type === "ObjectExpression") {
    const value: Record<string, unknown> = Object.create(null);
    for (const property of node.properties) {
      if (property.type !== "Property" || property.computed || property.kind !== "init" || property.method || property.shorthand) {
        throw new Error("Workflow objects must use static properties without spreads");
      }
      const key = property.key.type === "Identifier" ? property.key.name : property.key.value;
      if (typeof key !== "string" || ["__proto__", "constructor", "prototype"].includes(key)) {
        throw new Error("Workflow contains an invalid property name");
      }
      value[key] = literal(property.value, depth + 1);
    }
    return value;
  }
  throw new Error("Workflow must contain only static object, array, and primitive literals");
}

function object(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${field} must be an object`);
  return value as Record<string, unknown>;
}

function strings(value: unknown, field: string, optional = false): string[] | undefined {
  if (value === undefined && optional) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new Error(`${field} must be an array of non-empty strings`);
  }
  return [...new Set(value.map((item) => (item as string).trim()))];
}

function validateCommands(value: unknown, field: string): Record<string, PermissionAction> | undefined {
  if (value === undefined) return undefined;
  const raw = object(value, field);
  const result: Record<string, PermissionAction> = {};
  for (const [pattern, action] of Object.entries(raw)) {
    if (!pattern.trim() || typeof action !== "string" || !ACTIONS.has(action)) {
      throw new Error(`${field}.${pattern} must be allow, ask, or deny`);
    }
    result[pattern.trim()] = action as PermissionAction;
  }
  if (!("*" in result)) throw new Error(`${field} must define a "*" rule`);
  return result;
}

function validateAgent(value: unknown, index: number): WorkflowAgentDefinition {
  const raw = object(value, `agents[${index}]`);
  const allowed = new Set(["id", "role", "prompt", "dependsOn", "tools", "skills", "permissions"]);
  const unknown = Object.keys(raw).find((key) => !allowed.has(key));
  if (unknown) throw new Error(`agents[${index}] contains unsupported field ${unknown}`);
  for (const key of ["id", "role", "prompt"] as const) {
    if (typeof raw[key] !== "string" || !(raw[key] as string).trim()) throw new Error(`agents[${index}].${key} is required`);
  }
  if (Buffer.byteLength(raw.prompt as string, "utf8") > MAX_PROMPT_BYTES) throw new Error(`agents[${index}].prompt is too large`);
  const permissions = raw.permissions === undefined ? undefined : object(raw.permissions, `agents[${index}].permissions`);
  if (permissions && Object.keys(permissions).some((key) => key !== "commands")) {
    throw new Error(`agents[${index}].permissions only supports commands`);
  }
  return {
    id: (raw.id as string).trim(),
    role: (raw.role as string).trim(),
    prompt: raw.prompt as string,
    dependsOn: strings(raw.dependsOn ?? [], `agents[${index}].dependsOn`)!,
    ...(raw.tools === undefined ? {} : { tools: strings(raw.tools, `agents[${index}].tools`, true)! }),
    ...(raw.skills === undefined ? {} : { skills: strings(raw.skills, `agents[${index}].skills`, true)! }),
    ...(permissions ? { permissions: { commands: validateCommands(permissions.commands, `agents[${index}].permissions.commands`) } } : {}),
  };
}

export function parseWorkflow(source: string): WorkflowDefinition {
  if (!source.trim()) throw new Error("Workflow source is empty");
  if (Buffer.byteLength(source, "utf8") > MAX_SOURCE_BYTES) throw new Error("Workflow source is too large");
  const program: any = parse(source, { ecmaVersion: "latest", sourceType: "module" });
  if (program.body.length !== 1 || program.body[0].type !== "ExportNamedDeclaration") {
    throw new Error("Workflow must contain only `export const workflow = {...}`");
  }
  const declaration = program.body[0].declaration;
  const item = declaration?.type === "VariableDeclaration" && declaration.kind === "const" && declaration.declarations.length === 1
    ? declaration.declarations[0]
    : undefined;
  if (item?.id?.type !== "Identifier" || item.id.name !== "workflow" || !item.init) {
    throw new Error("Workflow must export a static const named workflow");
  }
  const raw = object(literal(item.init), "workflow");
  if (Object.keys(raw).some((key) => !["name", "description", "agents"].includes(key))) {
    throw new Error("Workflow contains unsupported top-level fields");
  }
  if (typeof raw.name !== "string" || !raw.name.trim()) throw new Error("workflow.name is required");
  if (raw.description !== undefined && typeof raw.description !== "string") throw new Error("workflow.description must be a string");
  if (!Array.isArray(raw.agents) || raw.agents.length === 0 || raw.agents.length > MAX_AGENTS) {
    throw new Error(`workflow.agents must contain 1-${MAX_AGENTS} agents`);
  }
  return {
    name: raw.name.trim(),
    ...(typeof raw.description === "string" && raw.description.trim() ? { description: raw.description.trim() } : {}),
    agents: raw.agents.map(validateAgent),
  };
}

export function workflowWaves(agents: WorkflowAgentDefinition[]): string[][] {
  const ids = new Set<string>();
  for (const agent of agents) {
    if (!AGENT_ID_PATTERN.test(agent.id)) throw new Error(`Invalid agent id ${JSON.stringify(agent.id)}`);
    if (ids.has(agent.id)) throw new Error(`Duplicate agent id ${agent.id}`);
    ids.add(agent.id);
  }
  for (const agent of agents) {
    for (const dependency of agent.dependsOn) {
      if (!ids.has(dependency)) throw new Error(`Agent ${agent.id} depends on unknown agent ${dependency}`);
      if (dependency === agent.id) throw new Error(`Agent ${agent.id} cannot depend on itself`);
    }
  }
  const remaining = new Set(agents.map((agent) => agent.id));
  const completed = new Set<string>();
  const waves: string[][] = [];
  while (remaining.size) {
    const wave = agents.filter((agent) => remaining.has(agent.id) && agent.dependsOn.every((id) => completed.has(id))).map((agent) => agent.id);
    if (!wave.length) throw new Error("Workflow dependency graph contains a cycle");
    waves.push(wave);
    for (const id of wave) { remaining.delete(id); completed.add(id); }
  }
  return waves;
}

/** Return valid agent output placeholders in first-occurrence order. */
export function agentOutputReferences(prompt: string): string[] {
  const references: string[] = [];
  const seen = new Set<string>();
  for (const match of prompt.matchAll(OUTPUT_REFERENCE_PATTERN)) {
    const id = match[1]!;
    if (!seen.has(id)) { seen.add(id); references.push(id); }
  }
  return references;
}

/** Return the first malformed output placeholder, including bad delimiters. */
export function invalidAgentOutputPlaceholder(prompt: string): string | undefined {
  const prefix = "{{agents.";
  let cursor = 0;
  while (cursor < prompt.length) {
    const start = prompt.indexOf(prefix, cursor);
    if (start < 0) return undefined;
    const end = prompt.indexOf("}}", start + prefix.length);
    if (end < 0) return prompt.slice(start);
    const candidate = prompt.slice(start, end + 2);
    if (
      !COMPLETE_OUTPUT_REFERENCE_PATTERN.test(candidate) ||
      prompt[start - 1] === "{" ||
      prompt[end + 2] === "}"
    ) {
      return prompt.slice(start, end + (prompt[end + 2] === "}" ? 3 : 2));
    }
    cursor = end + 2;
  }
  return undefined;
}

/**
 * Ensure every output placeholder names an agent which is guaranteed to have
 * completed before the prompt runs. Transitive dependencies are available.
 */
export function validateWorkflowOutputReferences(agents: WorkflowAgentDefinition[]): void {
  workflowWaves(agents);
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  const ancestors = new Map<string, Set<string>>();
  const dependenciesOf = (id: string): Set<string> => {
    const cached = ancestors.get(id);
    if (cached) return cached;
    const result = new Set<string>();
    ancestors.set(id, result);
    for (const dependency of byId.get(id)!.dependsOn) {
      result.add(dependency);
      for (const ancestor of dependenciesOf(dependency)) result.add(ancestor);
    }
    return result;
  };

  for (const agent of agents) {
    const malformed = invalidAgentOutputPlaceholder(agent.prompt);
    if (malformed) {
      throw new Error(`Agent ${agent.id} contains an invalid agent output placeholder: ${malformed}`);
    }
    for (const referencedId of agentOutputReferences(agent.prompt)) {
      if (!byId.has(referencedId)) throw new Error(`Agent ${agent.id} references output from unknown agent ${referencedId}`);
      if (!dependenciesOf(agent.id).has(referencedId)) {
        throw new Error(`Agent ${agent.id} references output from ${referencedId} without depending on it`);
      }
    }
  }
}

function subset(requested: string[] | undefined, allowed: string[], field: string): string[] {
  if (requested === undefined) return [...allowed];
  const missing = requested.find((item) => !allowed.includes(item));
  if (missing) throw new Error(`${field} cannot add ${missing}; it is not allowed by the role`);
  return requested;
}

export function resolveWorkflow(source: string, roles: ReadonlyMap<string, RoleDefinition>): ResolvedWorkflow {
  const definition = parseWorkflow(source);
  const waves = workflowWaves(definition.agents);
  validateWorkflowOutputReferences(definition.agents);
  const agents: ResolvedAgentDefinition[] = definition.agents.map((agent) => {
    const role = roles.get(agent.role);
    if (!role) throw new Error(`Unknown role ${agent.role}`);
    return {
      ...agent,
      resolvedRole: role,
      effectiveTools: subset(agent.tools, role.tools, `Agent ${agent.id} tools`),
      effectiveSkills: subset(agent.skills, role.skills, `Agent ${agent.id} skills`),
    };
  });
  return { source, definition, agents, waves };
}

export function expandAgentOutputs(prompt: string, outputs: ReadonlyMap<string, string>): string {
  return prompt.replace(/\{\{agents\.([A-Za-z][A-Za-z0-9_-]{0,63})\.output\}\}/g, (_match, id: string) => outputs.get(id) ?? "");
}
