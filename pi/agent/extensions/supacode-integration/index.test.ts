import { describe, expect, spyOn, test } from "bun:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import supacodeIntegration, { notifyField, promptActivityTransition } from "./index.ts";
import * as terminal from "./terminal.ts";

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

function withIntegration(
  run: (emit: (name: string, event?: unknown) => void, writes: string[]) => void,
) {
  const previousSurface = process.env.SUPACODE_SURFACE_ID;
  process.env.SUPACODE_SURFACE_ID = "test-surface";
  const writes: string[] = [];
  const writer = spyOn(terminal, "writeToTerminal").mockImplementation(
    (sequence) => { writes.push(sequence); },
  );
  const handlers = new Map<string, (event: any, ctx: ExtensionContext) => unknown>();
  const pi = {
    on: (name: string, handler: (event: any, ctx: ExtensionContext) => unknown) => {
      handlers.set(name, handler);
    },
    events: { on: () => () => {} },
  } as unknown as ExtensionAPI;
  const ctx = {
    isIdle: () => false,
    sessionManager: {
      getBranch: () => [{
        type: "message",
        message: { role: "assistant", content: [{ type: "text", text: "Finished" }] },
      }],
    },
  } as unknown as ExtensionContext;
  try {
    supacodeIntegration(pi);
    writes.length = 0;
    run((name, event = {}) => {
      const handler = handlers.get(name);
      if (!handler) throw new Error(`Missing handler: ${name}`);
      handler(event, ctx);
    }, writes);
  } finally {
    writer.mockRestore();
    if (previousSurface === undefined) delete process.env.SUPACODE_SURFACE_ID;
    else process.env.SUPACODE_SURFACE_ID = previousSurface;
  }
}

describe("Supacode settled notifications", () => {
  test("normal completion resets presence and sends the latest assistant text", () => {
    withIntegration((emit, writes) => {
      emit("agent_settled", { aborted: false });
      expect(writes).toHaveLength(2);
      expect(writes[0]).toContain("event=idle");
      expect(writes[1]).toContain("kind=notify");
      expect(writes[1]).toContain(`body=${notifyField("Finished", 1000)}`);
    });
  });

  test("cancellation resets presence without sending stale assistant text", () => {
    withIntegration((emit, writes) => {
      emit("agent_settled", { aborted: true });
      expect(writes).toHaveLength(1);
      expect(writes[0]).toContain("event=idle");
      expect(writes.join("")).not.toContain("kind=notify");
    });
  });

  test("cancellation clears prompt state so a late dialog close cannot resume busy", () => {
    withIntegration((emit, writes) => {
      emit("agent_start");
      emit("ui_prompt_start");
      emit("agent_settled", { aborted: true });
      writes.length = 0;
      emit("ui_prompt_end");
      expect(writes).toEqual([]);
    });
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
