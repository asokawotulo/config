import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadRoles, parseRoleFile } from "./roles.ts";
import { resolveWorkflow } from "./workflow.ts";

const cleanup: string[] = [];
afterEach(() => {
  for (const path of cleanup.splice(0)) rmSync(path, { recursive: true, force: true });
});

function temporaryAgentDir(): string {
  const directory = mkdtempSync(join(tmpdir(), "dynamic-role-"));
  cleanup.push(directory);
  return directory;
}

describe("dynamic workflow roles", () => {
  test("loads roles without command permission frontmatter", () => {
    const dir = temporaryAgentDir();
    const path = join(dir, "reader.md");
    writeFileSync(path, `---\ndescription: Reader\nmodel: openai-codex/gpt-5.6-sol\ntools: [read, bash]\nskills: []\n---\nRead carefully.\n`);
    const role = parseRoleFile(path);
    expect(role.name).toBe("reader");
    expect(role.tools).toEqual(["read", "bash"]);
    expect(role.prompt).toBe("Read carefully.");
  });

  test("still validates required role resources", () => {
    const dir = temporaryAgentDir();
    const path = join(dir, "broken.md");
    writeFileSync(path, `---\ndescription: Broken\nmodel: openai-codex/gpt-5.6-sol\ntools: nope\nskills: []\n---\nNo.\n`);
    expect(() => parseRoleFile(path)).toThrow("tools must be an array");
  });

  test("loads valid roles while reporting malformed unused roles", () => {
    const agentDir = temporaryAgentDir();
    const rolesDir = join(agentDir, "roles");
    mkdirSync(rolesDir);
    writeFileSync(join(rolesDir, "reader.md"), `---\ndescription: Reader\nmodel: openai-codex/gpt-5.6-sol\ntools: [read]\nskills: []\n---\nRead.\n`);
    writeFileSync(join(rolesDir, "broken.md"), `---\ndescription: Broken\nmodel: openai-codex/gpt-5.6-sol\ntools: nope\nskills: []\n---\nNo.\n`);

    const loaded = loadRoles(agentDir);
    expect([...loaded.roles.keys()]).toEqual(["reader"]);
    expect(loaded.diagnostics).toHaveLength(1);
    expect(loaded.diagnostics[0]?.name).toBe("broken");
    expect(loaded.diagnostics[0]?.error).toContain("tools must be an array");

    const source = `export const workflow = { name: "invalid role", agents: [{ id: "a", role: "broken", prompt: "work", dependsOn: [] }] }`;
    expect(() => resolveWorkflow(source, loaded.roles, undefined, loaded.diagnostics)).toThrow("Role broken is invalid: Role broken tools must be an array");
  });
});
