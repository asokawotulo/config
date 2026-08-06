import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { getAgentDir, parseFrontmatter } from "@earendil-works/pi-coding-agent";
import type { PermissionAction, RoleDefinition } from "./types.ts";

const ACTIONS = new Set<PermissionAction>(["allow", "ask", "deny"]);

function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new Error(`${field} must be an array of non-empty strings`);
  }
  return [...new Set(value.map((item) => (item as string).trim()))];
}

function parseCommands(value: unknown, roleName: string): Record<string, PermissionAction> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Role ${roleName} permissions.commands must be an object`);
  }
  const result: Record<string, PermissionAction> = {};
  for (const [pattern, action] of Object.entries(value)) {
    if (!pattern.trim() || typeof action !== "string" || !ACTIONS.has(action as PermissionAction)) {
      throw new Error(`Role ${roleName} has invalid command rule ${JSON.stringify(pattern)}`);
    }
    result[pattern.trim()] = action as PermissionAction;
  }
  if (!("*" in result)) throw new Error(`Role ${roleName} must define a "*" command rule`);
  return result;
}

export function parseRoleFile(filePath: string): RoleDefinition {
  const name = basename(filePath, extname(filePath));
  const parsed = parseFrontmatter<Record<string, unknown>>(readFileSync(filePath, "utf8"));
  const meta = parsed.frontmatter;
  if (typeof meta.description !== "string" || !meta.description.trim()) {
    throw new Error(`Role ${name} requires description`);
  }
  if (typeof meta.model !== "string" || !meta.model.includes("/")) {
    throw new Error(`Role ${name} requires a provider/model value`);
  }
  const thinking = meta.thinking;
  const thinkingLevels = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
  if (thinking !== undefined && (typeof thinking !== "string" || !thinkingLevels.has(thinking))) {
    throw new Error(`Role ${name} has invalid thinking level`);
  }
  const permissions = meta.permissions;
  if (!permissions || typeof permissions !== "object" || Array.isArray(permissions)) {
    throw new Error(`Role ${name} requires permissions.commands`);
  }
  const commands = parseCommands((permissions as Record<string, unknown>).commands, name);
  return {
    name,
    description: meta.description.trim(),
    model: meta.model.trim(),
    ...(typeof thinking === "string" ? { thinking: thinking as RoleDefinition["thinking"] } : {}),
    tools: stringArray(meta.tools, `Role ${name} tools`),
    skills: stringArray(meta.skills, `Role ${name} skills`),
    permissions: { commands },
    prompt: parsed.body.trim(),
    filePath,
  };
}

export function loadRoles(agentDir = getAgentDir()): Map<string, RoleDefinition> {
  const directory = join(agentDir, "roles");
  const roles = new Map<string, RoleDefinition>();
  if (!existsSync(directory)) return roles;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isFile() || extname(entry.name) !== ".md") continue;
    const role = parseRoleFile(join(directory, entry.name));
    roles.set(role.name, role);
  }
  return roles;
}
