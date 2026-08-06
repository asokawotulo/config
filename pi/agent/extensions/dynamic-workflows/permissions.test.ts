import { describe, expect, test } from "bun:test";
import { explainCommand, matchCommandPolicy } from "./permissions.ts";

describe("dynamic workflow permissions", () => {
  const rules = { "*": "deny", git: "ask", "git status": "allow", "git diff *": "allow", "rg *": "allow" } as const;

  test("uses the most specific command rule", () => {
    expect(matchCommandPolicy("git status", rules)).toEqual({ action: "allow", pattern: "git status" });
    expect(matchCommandPolicy("git push origin main", rules)).toEqual({ action: "ask", pattern: "git" });
    expect(matchCommandPolicy("curl example.com", rules).action).toBe("deny");
  });

  test("uses CC Safety Net structured parsing and verdicts", async () => {
    const safe = await explainCommand("git status && rg test .", process.cwd());
    expect(safe.result.result).toBe("allowed");
    expect(safe.segments).toEqual(["git status", "rg test ."]);
    const redirected = await explainCommand("git status > /tmp/status", process.cwd());
    expect(redirected.segments).toEqual(["git status > /tmp/status"]);
    expect(matchCommandPolicy(redirected.segments[0]!, rules).action).toBe("ask");
    const blocked = await explainCommand("git reset --hard", process.cwd());
    expect(blocked.result.result).toBe("blocked");
    expect(blocked.result.reason).toContain("destroys");
  });
});
