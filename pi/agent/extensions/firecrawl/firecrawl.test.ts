import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { Effect } from "effect";
import { cachedRequest, requestHash } from "./cache.ts";
import { crawlEffect, type CrawlClient } from "./crawl.ts";
import firecrawlTools from "./index.ts";
import { acquireLock } from "./lock.ts";

const temporaryDirectories: string[] = [];
const originalCacheDirectory = process.env.FIRECRAWL_CACHE_DIR;

afterEach(async () => {
  if (originalCacheDirectory === undefined) {
    delete process.env.FIRECRAWL_CACHE_DIR;
  } else {
    process.env.FIRECRAWL_CACHE_DIR = originalCacheDirectory;
  }
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function useTemporaryCache(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "firecrawl-cache-test-"));
  temporaryDirectories.push(directory);
  process.env.FIRECRAWL_CACHE_DIR = directory;
  return directory;
}

describe("crawl lifecycle", () => {
  test("cancels the remote crawl when polling is interrupted", async () => {
    let pollingStarted!: () => void;
    const startedPolling = new Promise<void>((resolve) => {
      pollingStarted = resolve;
    });
    const cancelledJobs: string[] = [];

    const client: CrawlClient = {
      startCrawl: async (url) => ({ id: "crawl-123", url }),
      getCrawlStatus: async () => {
        pollingStarted();
        return new Promise(() => undefined);
      },
      cancelCrawl: async (jobId) => {
        cancelledJobs.push(jobId);
        return true;
      },
    };

    const controller = new AbortController();
    const running = Effect.runPromise(
      crawlEffect(client, "https://example.com", { limit: 1 }),
      { signal: controller.signal },
    );

    await startedPolling;
    controller.abort();
    await expect(running).rejects.toBeDefined();
    expect(cancelledJobs).toEqual(["crawl-123"]);
  });
});

describe("shared cache", () => {
  test("removes a newly created lock when owner initialization fails", async () => {
    const root = await useTemporaryCache();
    const lockDirectory = join(root, "owner-failure.lock");
    const initializationError = new Error("owner initialization failed");

    await expect(
      acquireLock(lockDirectory, undefined, async () => {
        throw initializationError;
      }),
    ).rejects.toBe(initializationError);
    await expect(stat(lockDirectory)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("produces stable hashes for differently ordered objects", () => {
    expect(requestHash("search", { query: "pi", limit: 5 })).toBe(
      requestHash("search", { limit: 5, query: "pi" }),
    );
  });

  test("stores request metadata, raw details, and model output", async () => {
    const root = await useTemporaryCache();
    const request = { url: "https://example.com", onlyMainContent: true };
    const details = {
      status: "completed",
      data: [{ markdown: "# Example" }, { markdown: "Second page" }],
    };

    const result = await cachedRequest({
      operation: "crawl",
      request,
      mode: "refresh",
      outputFormat: "json",
      fetch: async () => ({ details, output: JSON.stringify(details) }),
    });

    expect(result.cacheHit).toBe(false);
    expect(result.cacheDirectory).toStartWith(root);
    expect(
      JSON.parse(await readFile(join(result.cacheDirectory!, "request.json"), "utf8")),
    ).toEqual(request);
    expect(
      JSON.parse(await readFile(join(result.cacheDirectory!, "details.json"), "utf8")),
    ).toEqual(details);
    expect(await readFile(join(result.cacheDirectory!, "output.json"), "utf8")).toBe(
      JSON.stringify(details),
    );
    expect(
      await readFile(join(result.cacheDirectory!, "documents", "0001.md"), "utf8"),
    ).toBe("# Example");
  });

  test("reuses a valid result without invoking the fetch callback", async () => {
    await useTemporaryCache();
    const request = { query: "pi coding agent", limit: 5 };
    let fetchCount = 0;
    const fetch = async () => {
      fetchCount += 1;
      return { details: { results: ["one"] }, output: '{"results":["one"]}' };
    };

    await cachedRequest({
      operation: "search",
      request,
      mode: "prefer-cache",
      outputFormat: "json",
      fetch,
    });
    const second = await cachedRequest({
      operation: "search",
      request,
      mode: "prefer-cache",
      outputFormat: "json",
      fetch,
    });

    expect(fetchCount).toBe(1);
    expect(second.cacheHit).toBe(true);
    expect(second.details).toEqual({ results: ["one"] });
  });

  test("does not load raw details when the caller does not need them", async () => {
    await useTemporaryCache();
    const request = { query: "cached output only", limit: 5 };
    const first = await cachedRequest({
      operation: "search",
      request,
      mode: "prefer-cache",
      outputFormat: "json",
      fetch: async () => ({
        details: { results: ["raw"] },
        output: '{"results":["raw"]}',
      }),
    });
    await writeFile(join(first.cacheDirectory!, "details.json"), "invalid json");

    const second = await cachedRequest({
      operation: "search",
      request,
      mode: "prefer-cache",
      outputFormat: "json",
      loadDetails: false,
      fetch: async () => {
        throw new Error("cache entry should be reused");
      },
    });

    expect(second.cacheHit).toBe(true);
    expect(second.output).toBe('{"results":["raw"]}');
    expect(second).not.toHaveProperty("details");
  });

  test("returns only compact operation and cache details from the registered tool", async () => {
    await useTemporaryCache();
    const request = { query: "compact details", limit: 5, source: "web", scrapeResults: false };
    await cachedRequest({
      operation: "search",
      request,
      mode: "prefer-cache",
      outputFormat: "json",
      fetch: async () => ({
        details: { results: ["raw detail must stay in the cache"] },
        output: '{"results":["model output"]}',
      }),
    });

    let searchTool: any;
    firecrawlTools({
      registerTool(tool: { name: string }) {
        if (tool.name === "firecrawl_search") searchTool = tool;
      },
    } as never);
    const result = await searchTool.execute("call", { query: request.query }, undefined, undefined);

    expect(Object.keys(result.details)).toEqual(["operation", "cache"]);
    expect(result.details).toEqual({
      operation: "search",
      cache: {
        hit: true,
        directory: expect.any(String),
        fetchedAt: expect.any(String),
      },
    });
    expect(JSON.stringify(result.details)).not.toContain("raw detail");
  });

  test("deduplicates concurrent identical requests", async () => {
    await useTemporaryCache();
    const request = { url: "https://example.com" };
    let fetchCount = 0;
    const fetch = async () => {
      fetchCount += 1;
      await sleep(50);
      return { details: { markdown: "hello" }, output: "hello" };
    };

    const results = await Promise.all([
      cachedRequest({
        operation: "scrape",
        request,
        mode: "prefer-cache",
        outputFormat: "md",
        fetch,
      }),
      cachedRequest({
        operation: "scrape",
        request,
        mode: "prefer-cache",
        outputFormat: "md",
        fetch,
      }),
    ]);

    expect(fetchCount).toBe(1);
    expect(results.filter((result) => result.cacheHit)).toHaveLength(1);
  });
});
