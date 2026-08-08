import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { getAgentDir, parseFrontmatter } from "@earendil-works/pi-coding-agent";
import type { LoadedRoles, RoleDefinition, RoleLoadDiagnostic } from "./types.ts";

function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new Error(`${field} must be an array of non-empty strings`);
  }
  return [...new Set(value.map((item) => (item as string).trim()))];
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
  return {
    name,
    description: meta.description.trim(),
    model: meta.model.trim(),
    ...(typeof thinking === "string" ? { thinking: thinking as RoleDefinition["thinking"] } : {}),
    tools: stringArray(meta.tools, `Role ${name} tools`),
    skills: stringArray(meta.skills, `Role ${name} skills`),
    prompt: parsed.body.trim(),
    filePath,
  };
}

export function loadRoles(agentDir = getAgentDir()): LoadedRoles {
  const directory = join(agentDir, "roles");
  const roles = new Map<string, RoleDefinition>();
  const diagnostics: RoleLoadDiagnostic[] = [];
  if (!existsSync(directory)) return { roles, diagnostics };
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isFile() || extname(entry.name) !== ".md") continue;
    const filePath = join(directory, entry.name);
    try {
      const role = parseRoleFile(filePath);
      roles.set(role.name, role);
    } catch (error) {
      diagnostics.push({
        name: basename(entry.name, extname(entry.name)),
        filePath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { roles, diagnostics };
}
