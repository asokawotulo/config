import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const LOCK_STALE_MS = 20 * 60 * 1_000;
const LOCK_POLL_MS = 100;

type WriteOwnerFile = (
  path: string,
  data: string,
  options: { mode: number },
) => Promise<unknown>;

async function initializeOwner(
  lockDirectory: string,
  writeOwnerFile: WriteOwnerFile,
): Promise<void> {
  await writeOwnerFile(
    join(lockDirectory, "owner.json"),
    `${JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })}\n`,
    { mode: 0o600 },
  );
}

export async function acquireLock(
  lockDirectory: string,
  signal: AbortSignal | undefined,
  writeOwnerFile: WriteOwnerFile = writeFile,
): Promise<void> {
  while (true) {
    if (signal?.aborted) throw new Error("Firecrawl request cancelled");

    try {
      await mkdir(lockDirectory, { mode: 0o700 });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw error;

      try {
        const lockStat = await stat(lockDirectory);
        if (Date.now() - lockStat.mtimeMs > LOCK_STALE_MS) {
          await rm(lockDirectory, { recursive: true, force: true });
          continue;
        }
      } catch {
        continue;
      }
      await sleep(LOCK_POLL_MS, undefined, signal ? { signal } : undefined);
      continue;
    }

    try {
      await initializeOwner(lockDirectory, writeOwnerFile);
      return;
    } catch (error) {
      await rm(lockDirectory, { recursive: true, force: true });
      throw error;
    }
  }
}
