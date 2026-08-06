import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseRoleFile } from "./roles.ts";

describe("dynamic workflow roles", () => {
  test("loads strict nested permission frontmatter", () => {
    const dir = mkdtempSync(join(tmpdir(), "dynamic-role-"));
    const path = join(dir, "reader.md");
    writeFileSync(path, `---\ndescription: Reader\nmodel: openai-codex/gpt-5.6-sol\ntools: [read, bash]\nskills: []\npermissions:\n  commands:\n    "*": deny\n    "rg *": allow\n---\nRead carefully.\n`);
    const role = parseRoleFile(path);
    expect(role.name).toBe("reader");
    expect(role.permissions.commands["rg *"]).toBe("allow");
    expect(role.prompt).toBe("Read carefully.");
  });

  test("requires default deny coverage", () => {
    const dir = mkdtempSync(join(tmpdir(), "dynamic-role-"));
    const path = join(dir, "broken.md");
    writeFileSync(path, `---\ndescription: Broken\nmodel: openai-codex/gpt-5.6-sol\ntools: []\nskills: []\npermissions:\n  commands:\n    "rg *": allow\n---\nNo.\n`);
    expect(() => parseRoleFile(path)).toThrow('must define a "*"');
  });
});
