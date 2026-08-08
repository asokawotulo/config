export type FirecrawlOperation = "search" | "scrape" | "crawl";

export type CacheMode = "prefer-cache" | "refresh" | "no-store";

export type OutputFormat = "json" | "md";

export interface CachedPayload<T> {
  details: T;
  output: string;
}

export interface CacheMetadata {
  schemaVersion: "v1";
  operation: FirecrawlOperation;
  requestHash: string;
  fetchedAt: string;
  expiresAt: string;
  outputFile: "output.json" | "output.md";
  producer: {
    extension: "firecrawl";
    firecrawlSdkVersion: string;
  };
  artifacts: string[];
}

export interface CacheResolution<T> {
  details?: T;
  output: string;
  cacheHit: boolean;
  cacheDirectory?: string;
  outputPath?: string;
  fetchedAt: string;
}
