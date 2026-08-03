import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { truncateSessionTitle } from "./dialog.ts";
import {
  deleteSessionFile,
  renameSessionFile,
} from "./session-files.ts";
import { DELETE_WINDOW_MS, SessionManagerState } from "./state.ts";

const temporaryDirectories: string[] = [];

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "pi-session-manager-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("session manager display", () => {
  test("keeps titles at or below 100 characters unchanged", () => {
    const title = "a".repeat(100);
    expect(truncateSessionTitle(title)).toBe(title);
  });

  test("truncates longer titles to 100 characters with trailing ellipses", () => {
    const title = truncateSessionTitle("a".repeat(101));
    expect(title).toHaveLength(100);
    expect(title).toBe(`${"a".repeat(97)}...`);
  });
});

describe("session manager selection", () => {
  test("movement stays within the session list", () => {
    const state = new SessionManagerState();

    state.move(-1, 3);
    expect(state.selectedIndex).toBe(0);
    state.move(10, 3);
    expect(state.selectedIndex).toBe(2);
    state.move(-1, 3);
    expect(state.selectedIndex).toBe(1);
    state.clamp(1);
    expect(state.selectedIndex).toBe(0);
  });

  test("two matching delete requests within the window trigger deletion", () => {
    const state = new SessionManagerState();

    expect(state.requestDelete("one.jsonl", 1_000)).toBe("armed");
    expect(state.requestDelete("one.jsonl", 1_000 + DELETE_WINDOW_MS)).toBe(
      "delete",
    );
  });

  test("a different session or an expired window rearms deletion", () => {
    const state = new SessionManagerState();

    expect(state.requestDelete("one.jsonl", 1_000)).toBe("armed");
    expect(state.requestDelete("two.jsonl", 1_100)).toBe("armed");
    expect(
      state.requestDelete("two.jsonl", 1_100 + DELETE_WINDOW_MS + 1),
    ).toBe("armed");
  });

  test("navigation and timeout clear an armed deletion", () => {
    const state = new SessionManagerState();

    state.requestDelete("one.jsonl", 1_000);
    state.move(1, 2);
    expect(state.isDeleteArmed("one.jsonl", 1_100)).toBe(false);

    state.requestDelete("two.jsonl", 2_000);
    expect(state.expireDelete(2_000 + DELETE_WINDOW_MS)).toBe(true);
    expect(state.isDeleteArmed("two.jsonl", 4_000)).toBe(false);
  });
});

describe("session file mutations", () => {
  test("renames an inactive session by appending session metadata", async () => {
    const directory = await createTemporaryDirectory();
    const sessionPath = join(directory, "session.jsonl");
    await writeFile(
      sessionPath,
      `${JSON.stringify({
        type: "session",
        version: 3,
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        cwd: directory,
      })}\n`,
    );

    renameSessionFile(sessionPath, "Renamed session");

    expect(SessionManager.open(sessionPath).getSessionName()).toBe(
      "Renamed session",
    );
  });

  test("uses trash when it removes the session", async () => {
    const directory = await createTemporaryDirectory();
    const sessionPath = join(directory, "session.jsonl");
    await writeFile(sessionPath, "session");

    const result = await deleteSessionFile(sessionPath, async (args) => {
      expect(args).toEqual([sessionPath]);
      await unlink(sessionPath);
      return { code: 0 };
    });

    expect(result).toEqual({ method: "trash" });
  });

  test("falls back to unlink when trash fails", async () => {
    const directory = await createTemporaryDirectory();
    const sessionPath = join(directory, "session.jsonl");
    await writeFile(sessionPath, "session");

    const result = await deleteSessionFile(sessionPath, async () => ({
      code: 1,
      stderr: "trash unavailable",
    }));

    expect(result).toEqual({ method: "unlink" });
  });
});
