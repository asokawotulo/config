import { describe, expect, test } from "bun:test";
import { notifyField, promptActivityTransition } from "./index.ts";

describe("Supacode notification fields", () => {
  test("truncates at a UTF-8 character boundary", () => {
    const decoded = Buffer.from(notifyField("a😀b", 4), "base64").toString(
      "utf8",
    );

    expect(decoded).toBe("a");
    expect(decoded).not.toContain("�");
    expect(Buffer.byteLength(decoded, "utf8")).toBeLessThanOrEqual(4);
  });
});

describe("Supacode prompt activity", () => {
  test("pauses and resumes active agent presence around a prompt", () => {
    const waiting = promptActivityTransition("start", false, false);
    expect(waiting).toEqual({ waitingForUser: true, presence: "idle" });

    expect(
      promptActivityTransition("end", waiting.waitingForUser, false),
    ).toEqual({ waitingForUser: false, presence: "busy" });
  });

  test("ignores prompts opened while the agent is idle", () => {
    expect(promptActivityTransition("start", false, true)).toEqual({
      waitingForUser: false,
    });
    expect(promptActivityTransition("end", false, true)).toEqual({
      waitingForUser: false,
    });
  });

  test("does not resume busy presence after the agent settles", () => {
    expect(promptActivityTransition("end", true, true)).toEqual({
      waitingForUser: false,
    });
  });
});
