import { Cause, Effect, Exit } from "effect";
import type { CrawlJob, Firecrawl } from "firecrawl";
import { StringEnum } from "@earendil-works/pi-ai";
import type {
  AgentToolUpdateCallback,
  ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { cachedRequest } from "./cache.ts";
import { createFirecrawlClient } from "./client.ts";
import { crawlEffect } from "./crawl.ts";
import { errorMessage } from "./error.ts";
import { formatForModel, stringify } from "./output.ts";
import {
  CACHE_MODE_DESCRIPTION,
  CRAWL_PARAMETER_DESCRIPTIONS,
  CRAWL_PROMPT_GUIDELINES,
  CRAWL_PROMPT_SNIPPET,
  CRAWL_TOOL_DESCRIPTION,
  SCRAPE_PARAMETER_DESCRIPTIONS,
  SCRAPE_PROMPT_GUIDELINES,
  SCRAPE_PROMPT_SNIPPET,
  SCRAPE_TOOL_DESCRIPTION,
  SEARCH_PARAMETER_DESCRIPTIONS,
  SEARCH_PROMPT_GUIDELINES,
  SEARCH_PROMPT_SNIPPET,
  SEARCH_TOOL_DESCRIPTION,
} from "./prompt.ts";
import type {
  CacheMode,
  CachedPayload,
  FirecrawlOperation,
  OutputFormat,
} from "./types.ts";

const CacheModeParameter = Type.Optional(
  StringEnum(["prefer-cache", "refresh", "no-store"] as const, {
    description: CACHE_MODE_DESCRIPTION,
  }),
);

async function runOperation<T>(options: {
  operation: FirecrawlOperation;
  request: unknown;
  cacheMode: CacheMode | undefined;
  outputFormat: OutputFormat;
  status: string;
  signal?: AbortSignal;
  onUpdate?: AgentToolUpdateCallback<unknown>;
  fetch: (client: Firecrawl) => Promise<CachedPayload<T>>;
}) {
  const {
    operation,
    request,
    cacheMode,
    outputFormat,
    status,
    signal,
    onUpdate,
    fetch,
  } = options;

  try {
    const result = await cachedRequest({
      operation,
      request,
      mode: cacheMode ?? "prefer-cache",
      outputFormat,
      signal,
      loadDetails: false,
      fetch: async () => {
        onUpdate?.({
          content: [{ type: "text", text: status }],
          details: undefined,
        });
        return fetch(createFirecrawlClient());
      },
    });

    const output = await formatForModel({
      operation,
      output: result.output,
      outputFormat,
      storedOutputPath: result.outputPath,
    });
    return {
      content: [{ type: "text" as const, text: output }],
      details: {
        operation,
        cache: {
          hit: result.cacheHit,
          directory: result.cacheDirectory,
          fetchedAt: result.fetchedAt,
        },
      },
    };
  } catch (error) {
    if (signal?.aborted) throw new Error("Firecrawl request cancelled");
    throw new Error(`Firecrawl ${operation} failed: ${errorMessage(error)}`, {
      cause: error,
    });
  }
}

async function runCrawlEffect(
  client: Firecrawl,
  url: string,
  options: Parameters<Firecrawl["startCrawl"]>[1],
  timeoutMs: number,
  signal: AbortSignal | undefined,
): Promise<CrawlJob> {
  const program = crawlEffect(client, url, options ?? {}).pipe(
    Effect.timeout(timeoutMs),
  );
  const exit = await Effect.runPromiseExit(
    program,
    signal ? { signal } : undefined,
  );
  if (Exit.isSuccess(exit)) return exit.value;
  if (Cause.hasInterruptsOnly(exit.cause)) {
    throw new Error("Firecrawl crawl cancelled");
  }
  throw Cause.squash(exit.cause);
}

export default function firecrawlTools(pi: ExtensionAPI) {
  pi.registerTool({
    name: "firecrawl_search",
    label: "Firecrawl Search",
    description: SEARCH_TOOL_DESCRIPTION,
    promptSnippet: SEARCH_PROMPT_SNIPPET,
    promptGuidelines: SEARCH_PROMPT_GUIDELINES,
    parameters: Type.Object({
      query: Type.String({ description: SEARCH_PARAMETER_DESCRIPTIONS.query }),
      limit: Type.Optional(
        Type.Integer({
          description: SEARCH_PARAMETER_DESCRIPTIONS.limit,
          minimum: 1,
          maximum: 20,
        }),
      ),
      source: Type.Optional(StringEnum(["web", "news", "images"] as const)),
      scrapeResults: Type.Optional(
        Type.Boolean({
          description: SEARCH_PARAMETER_DESCRIPTIONS.scrapeResults,
        }),
      ),
      cacheMode: CacheModeParameter,
    }),
    execute: (_toolCallId, params, signal, onUpdate) => {
      const request = {
        query: params.query,
        limit: params.limit ?? 5,
        source: params.source ?? "web",
        scrapeResults: params.scrapeResults ?? false,
      };
      return runOperation({
        operation: "search",
        request,
        cacheMode: params.cacheMode,
        outputFormat: "json",
        status: `Searching Firecrawl for: ${params.query}`,
        signal,
        onUpdate,
        fetch: async (client) => {
          const result = await client.search(params.query, {
            limit: request.limit,
            sources: [request.source],
            scrapeOptions: request.scrapeResults
              ? { formats: ["markdown"], timeout: 30_000 }
              : undefined,
            timeout: 30_000,
          });
          return { details: result, output: stringify(result) };
        },
      });
    },
  });

  pi.registerTool({
    name: "firecrawl_scrape",
    label: "Firecrawl Scrape",
    description: SCRAPE_TOOL_DESCRIPTION,
    promptSnippet: SCRAPE_PROMPT_SNIPPET,
    promptGuidelines: SCRAPE_PROMPT_GUIDELINES,
    parameters: Type.Object({
      url: Type.String({ description: SCRAPE_PARAMETER_DESCRIPTIONS.url }),
      onlyMainContent: Type.Optional(
        Type.Boolean({
          description: SCRAPE_PARAMETER_DESCRIPTIONS.onlyMainContent,
        }),
      ),
      waitFor: Type.Optional(
        Type.Integer({
          description: SCRAPE_PARAMETER_DESCRIPTIONS.waitFor,
          minimum: 0,
          maximum: 60_000,
        }),
      ),
      timeout: Type.Optional(
        Type.Integer({
          description: SCRAPE_PARAMETER_DESCRIPTIONS.timeout,
          minimum: 1,
          maximum: 120_000,
        }),
      ),
      includeMetadata: Type.Optional(
        Type.Boolean({
          description: SCRAPE_PARAMETER_DESCRIPTIONS.includeMetadata,
        }),
      ),
      cacheMode: CacheModeParameter,
    }),
    execute: (_toolCallId, params, signal, onUpdate) => {
      const request = {
        url: params.url,
        onlyMainContent: params.onlyMainContent ?? true,
        waitFor: params.waitFor,
        timeout: params.timeout ?? 30_000,
        includeMetadata: params.includeMetadata ?? false,
      };
      return runOperation({
        operation: "scrape",
        request,
        cacheMode: params.cacheMode,
        outputFormat: "md",
        status: `Scraping page with Firecrawl: ${params.url}`,
        signal,
        onUpdate,
        fetch: async (client) => {
          const document = await client.scrape(params.url, {
            formats: ["markdown"],
            onlyMainContent: request.onlyMainContent,
            waitFor: request.waitFor,
            timeout: request.timeout,
          });
          const metadata =
            request.includeMetadata && document.metadata
              ? `\n\nMetadata:\n${stringify(document.metadata)}`
              : "";
          const markdown =
            document.markdown?.trim() || "No markdown content returned.";
          return {
            details: document,
            output: `${markdown}${metadata}`,
          };
        },
      });
    },
  });

  pi.registerTool({
    name: "firecrawl_crawl",
    label: "Firecrawl Crawl",
    description: CRAWL_TOOL_DESCRIPTION,
    promptSnippet: CRAWL_PROMPT_SNIPPET,
    promptGuidelines: CRAWL_PROMPT_GUIDELINES,
    parameters: Type.Object({
      url: Type.String({ description: CRAWL_PARAMETER_DESCRIPTIONS.url }),
      limit: Type.Optional(
        Type.Integer({
          description: CRAWL_PARAMETER_DESCRIPTIONS.limit,
          minimum: 1,
          maximum: 100,
        }),
      ),
      maxDiscoveryDepth: Type.Optional(
        Type.Integer({
          description: CRAWL_PARAMETER_DESCRIPTIONS.maxDiscoveryDepth,
          minimum: 0,
        }),
      ),
      includePaths: Type.Optional(
        Type.Array(Type.String(), {
          description: CRAWL_PARAMETER_DESCRIPTIONS.includePaths,
        }),
      ),
      excludePaths: Type.Optional(
        Type.Array(Type.String(), {
          description: CRAWL_PARAMETER_DESCRIPTIONS.excludePaths,
        }),
      ),
      crawlEntireDomain: Type.Optional(
        Type.Boolean({
          description: CRAWL_PARAMETER_DESCRIPTIONS.crawlEntireDomain,
        }),
      ),
      allowSubdomains: Type.Optional(
        Type.Boolean({
          description: CRAWL_PARAMETER_DESCRIPTIONS.allowSubdomains,
        }),
      ),
      sitemap: Type.Optional(StringEnum(["include", "skip", "only"] as const)),
      onlyMainContent: Type.Optional(
        Type.Boolean({
          description: CRAWL_PARAMETER_DESCRIPTIONS.onlyMainContent,
        }),
      ),
      timeout: Type.Optional(
        Type.Integer({
          description: CRAWL_PARAMETER_DESCRIPTIONS.timeout,
          minimum: 1,
          maximum: 600,
        }),
      ),
      cacheMode: CacheModeParameter,
    }),
    execute: (_toolCallId, params, signal, onUpdate) => {
      const request = {
        url: params.url,
        limit: params.limit ?? 20,
        maxDiscoveryDepth: params.maxDiscoveryDepth,
        includePaths: params.includePaths,
        excludePaths: params.excludePaths,
        crawlEntireDomain: params.crawlEntireDomain,
        allowSubdomains: params.allowSubdomains,
        sitemap: params.sitemap,
        onlyMainContent: params.onlyMainContent ?? true,
      };
      return runOperation({
        operation: "crawl",
        request,
        cacheMode: params.cacheMode,
        outputFormat: "json",
        status: `Crawling up to ${request.limit} pages from: ${params.url}`,
        signal,
        onUpdate,
        fetch: async (client) => {
          const result = await runCrawlEffect(
            client,
            params.url,
            {
              limit: request.limit,
              maxDiscoveryDepth: request.maxDiscoveryDepth,
              includePaths: request.includePaths,
              excludePaths: request.excludePaths,
              crawlEntireDomain: request.crawlEntireDomain,
              allowSubdomains: request.allowSubdomains,
              sitemap: request.sitemap,
              scrapeOptions: {
                formats: ["markdown"],
                onlyMainContent: request.onlyMainContent,
              },
            },
            ((params.timeout ?? 120) + 5) * 1_000,
            signal,
          );
          if (result.status !== "completed") {
            throw new Error(`crawl finished with status ${result.status}`);
          }
          return { details: result, output: stringify(result) };
        },
      });
    },
  });
}
