import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseRoleFile } from "./roles.ts";

describe("dynamic workflow roles", () => {
  test("loads roles without command permission frontmatter", () => {
    const dir = mkdtempSync(join(tmpdir(), "dynamic-role-"));
    const path = join(dir, "reader.md");
    writeFileSync(path, `---\ndescription: Reader\nmodel: openai-codex/gpt-5.6-sol\ntools: [read, bash]\nskills: []\n---\nRead carefully.\n`);
    const role = parseRoleFile(path);
    expect(role.name).toBe("reader");
    expect(role.tools).toEqual(["read", "bash"]);
    expect(role.prompt).toBe("Read carefully.");
  });

  test("still validates required role resources", () => {
    const dir = mkdtempSync(join(tmpdir(), "dynamic-role-"));
    const path = join(dir, "broken.md");
    writeFileSync(path, `---\ndescription: Broken\nmodel: openai-codex/gpt-5.6-sol\ntools: nope\nskills: []\n---\nNo.\n`);
    expect(() => parseRoleFile(path)).toThrow("tools must be an array");
  });
});
