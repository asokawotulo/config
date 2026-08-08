import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { acquireLock } from "./lock.ts";
import type {
  CacheMetadata,
  CacheMode,
  CacheResolution,
  CachedPayload,
  FirecrawlOperation,
  OutputFormat,
} from "./types.ts";

const CACHE_SCHEMA_VERSION = "v1" as const;
const require = createRequire(import.meta.url);
const FIRECRAWL_SDK_VERSION = (
  require("firecrawl/package.json") as { version: string }
).version;
const DEFAULT_CACHE_TTL_MS: Record<FirecrawlOperation, number> = {
  search: 6 * 60 * 60 * 1_000,
  scrape: 7 * 24 * 60 * 60 * 1_000,
  crawl: 7 * 24 * 60 * 60 * 1_000,
};

function firecrawlCacheRoot(): string {
  return (
    process.env.FIRECRAWL_CACHE_DIR ??
    join(homedir(), ".firecrawl", "results")
  );
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value), null, 2);
}

export function requestHash(
  operation: FirecrawlOperation,
  request: unknown,
): string {
  return createHash("sha256")
    .update(canonicalJson({ schemaVersion: CACHE_SCHEMA_VERSION, operation, request }))
    .digest("hex");
}

function paths(operation: FirecrawlOperation, request: unknown) {
  const hash = requestHash(operation, request);
  const operationDirectory = join(
    firecrawlCacheRoot(),
    CACHE_SCHEMA_VERSION,
    operation,
  );
  return {
    hash,
    operationDirectory,
    directory: join(operationDirectory, hash),
    lockDirectory: join(operationDirectory, `${hash}.lock`),
  };
}

async function readEntry<T>(
  operation: FirecrawlOperation,
  request: unknown,
  now: number,
  loadDetails: boolean,
): Promise<CacheResolution<T> | undefined> {
  const { hash, directory } = paths(operation, request);
  try {
    const metadata = JSON.parse(
      await readFile(join(directory, "metadata.json"), "utf8"),
    ) as CacheMetadata;
    if (
      metadata.schemaVersion !== CACHE_SCHEMA_VERSION ||
      metadata.operation !== operation ||
      metadata.requestHash !== hash ||
      Date.parse(metadata.expiresAt) <= now
    ) {
      return undefined;
    }

    const [output, details] = await Promise.all([
      readFile(join(directory, metadata.outputFile), "utf8"),
      loadDetails
        ? readFile(join(directory, "details.json"), "utf8").then(
            (text) => JSON.parse(text) as T,
          )
        : Promise.resolve(undefined),
    ]);
    return {
      ...(loadDetails ? { details } : {}),
      output,
      cacheHit: true,
      cacheDirectory: directory,
      outputPath: join(directory, metadata.outputFile),
      fetchedAt: metadata.fetchedAt,
    };
  } catch {
    return undefined;
  }
}

function crawlDocuments(details: unknown): Array<{ name: string; markdown: string }> {
  if (!details || typeof details !== "object" || !("data" in details)) return [];
  const data = (details as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];

  return data.flatMap((document, index) => {
    if (!document || typeof document !== "object") return [];
    const markdown = (document as { markdown?: unknown }).markdown;
    if (typeof markdown !== "string") return [];
    return [{ name: `${String(index + 1).padStart(4, "0")}.md`, markdown }];
  });
}

async function writeEntry<T>(options: {
  operation: FirecrawlOperation;
  request: unknown;
  payload: CachedPayload<T>;
  outputFormat: OutputFormat;
  ttlMs: number;
  now: number;
}): Promise<{ directory: string; outputPath: string }> {
  const { operation, request, payload, outputFormat, ttlMs, now } = options;
  const { hash, operationDirectory, directory } = paths(operation, request);
  const temporaryDirectory = join(
    operationDirectory,
    `${hash}.tmp-${process.pid}-${randomUUID()}`,
  );
  const backupDirectory = join(
    operationDirectory,
    `${hash}.old-${process.pid}-${randomUUID()}`,
  );
  const outputFile = `output.${outputFormat}` as const;
  const documents = operation === "crawl" ? crawlDocuments(payload.details) : [];
  const artifacts = ["metadata.json", "request.json", "details.json", outputFile];
  artifacts.push(...documents.map(({ name }) => `documents/${name}`));

  await mkdir(temporaryDirectory, { recursive: true, mode: 0o700 });
  try {
    if (documents.length > 0) {
      await mkdir(join(temporaryDirectory, "documents"), { mode: 0o700 });
    }

    const fetchedAt = new Date(now).toISOString();
    const metadata: CacheMetadata = {
      schemaVersion: CACHE_SCHEMA_VERSION,
      operation,
      requestHash: hash,
      fetchedAt,
      expiresAt: new Date(now + ttlMs).toISOString(),
      outputFile,
      producer: {
        extension: "firecrawl",
        firecrawlSdkVersion: FIRECRAWL_SDK_VERSION,
      },
      artifacts,
    };

    await Promise.all([
      writeFile(join(temporaryDirectory, "request.json"), `${canonicalJson(request)}\n`, {
        mode: 0o600,
      }),
      writeFile(
        join(temporaryDirectory, "details.json"),
        `${JSON.stringify(payload.details, null, 2)}\n`,
        { mode: 0o600 },
      ),
      writeFile(join(temporaryDirectory, outputFile), payload.output, { mode: 0o600 }),
      ...documents.map(({ name, markdown }) =>
        writeFile(join(temporaryDirectory, "documents", name), markdown, {
          mode: 0o600,
        }),
      ),
    ]);
    // Metadata is written last; readers never accept a directory without it.
    await writeFile(
      join(temporaryDirectory, "metadata.json"),
      `${JSON.stringify(metadata, null, 2)}\n`,
      { mode: 0o600 },
    );

    let movedOldEntry = false;
    try {
      await rename(directory, backupDirectory);
      movedOldEntry = true;
    } catch {
      // No previous entry.
    }

    try {
      await rename(temporaryDirectory, directory);
    } catch (error) {
      if (movedOldEntry) await rename(backupDirectory, directory).catch(() => undefined);
      throw error;
    }
    if (movedOldEntry) await rm(backupDirectory, { recursive: true, force: true });

    return { directory, outputPath: join(directory, outputFile) };
  } catch (error) {
    await rm(temporaryDirectory, { recursive: true, force: true });
    throw error;
  }
}

export async function cachedRequest<T>(options: {
  operation: FirecrawlOperation;
  request: unknown;
  mode: CacheMode;
  outputFormat: OutputFormat;
  signal?: AbortSignal;
  ttlMs?: number;
  loadDetails?: boolean;
  fetch: () => Promise<CachedPayload<T>>;
}): Promise<CacheResolution<T>> {
  const {
    operation,
    request,
    mode,
    outputFormat,
    signal,
    fetch,
    loadDetails = true,
  } = options;
  const now = Date.now();

  if (mode === "no-store") {
    const payload = await fetch();
    return {
      ...(loadDetails ? { details: payload.details } : {}),
      output: payload.output,
      cacheHit: false,
      fetchedAt: new Date(now).toISOString(),
    };
  }

  const { operationDirectory, lockDirectory } = paths(operation, request);
  await mkdir(operationDirectory, { recursive: true, mode: 0o700 });
  await acquireLock(lockDirectory, signal);
  try {
    if (mode === "prefer-cache") {
      const hit = await readEntry<T>(operation, request, Date.now(), loadDetails);
      if (hit) return hit;
    }

    const payload = await fetch();
    const fetchedAtMs = Date.now();
    const stored = await writeEntry({
      operation,
      request,
      payload,
      outputFormat,
      ttlMs: options.ttlMs ?? DEFAULT_CACHE_TTL_MS[operation],
      now: fetchedAtMs,
    });
    return {
      ...(loadDetails ? { details: payload.details } : {}),
      output: payload.output,
      cacheHit: false,
      cacheDirectory: stored.directory,
      outputPath: stored.outputPath,
      fetchedAt: new Date(fetchedAtMs).toISOString(),
    };
  } finally {
    await rm(lockDirectory, { recursive: true, force: true });
  }
}

