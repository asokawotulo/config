export const CACHE_MODE_DESCRIPTION =
  "Cache behavior. prefer-cache (default) reuses a valid shared result; refresh fetches and replaces it; no-store fetches without reading or writing the cache.";

export const SEARCH_TOOL_DESCRIPTION =
  "Search the web with Firecrawl. Returns web, news, or image results and caches identical requests for 6 hours under ~/.firecrawl/results. Model output is limited to 50KB or 2000 lines; complete output remains in the cache.";

export const SEARCH_PROMPT_SNIPPET =
  "Search the web with Firecrawl for current information.";

export const SEARCH_PROMPT_GUIDELINES = [
  "Use firecrawl_search when the user asks for current web information, discovery, or sources beyond the local workspace.",
  "Use firecrawl_scrape after firecrawl_search when you need the full readable content of a specific page.",
  "Use firecrawl_crawl when the user needs content from multiple pages of the same website.",
];

export const SEARCH_PARAMETER_DESCRIPTIONS = {
  query: "The web search query.",
  limit: "Maximum number of results. Defaults to 5.",
  scrapeResults:
    "Whether to include markdown scraped from each result. Defaults to false.",
};

export const CRAWL_TOOL_DESCRIPTION =
  "Crawl multiple pages of a website with Firecrawl and return markdown documents. Defaults to 20 pages, allows at most 100, and caches identical requests for 7 days under ~/.firecrawl/results. Model output is limited to 50KB or 2000 lines; complete output and individual documents remain in the cache.";

export const CRAWL_PROMPT_SNIPPET =
  "Crawl multiple pages of a website with Firecrawl.";

export const CRAWL_PROMPT_GUIDELINES = [
  "Use firecrawl_crawl when the user needs content from multiple related pages on one website.",
  "Keep firecrawl_crawl limits as low as practical because each uncached page consumes Firecrawl credits.",
  "Use firecrawl_scrape instead of firecrawl_crawl when only one known URL is needed.",
];

export const CRAWL_PARAMETER_DESCRIPTIONS = {
  url: "The starting URL to crawl.",
  limit: "Maximum pages to crawl. Defaults to 20; maximum 100.",
  maxDiscoveryDepth: "Maximum link-discovery depth from the starting URL.",
  includePaths: "URL pathname regex patterns to include.",
  excludePaths: "URL pathname regex patterns to exclude.",
  crawlEntireDomain: "Allow sibling and parent paths on the same domain.",
  allowSubdomains: "Allow crawling subdomains.",
  onlyMainContent: "Extract only each page's main content. Defaults to true.",
  timeout: "Maximum crawl wait time in seconds. Defaults to 120.",
};

export const SCRAPE_TOOL_DESCRIPTION =
  "Scrape one page with Firecrawl and return markdown. Identical requests are cached for 7 days under ~/.firecrawl/results. Model output is limited to 50KB or 2000 lines; complete output remains in the cache.";

export const SCRAPE_PROMPT_SNIPPET =
  "Fetch one URL as readable markdown with Firecrawl.";

export const SCRAPE_PROMPT_GUIDELINES = [
  "Use firecrawl_scrape when you need the full readable markdown content of one known URL.",
  "Prefer firecrawl_scrape over bash or raw HTTP fetching for web pages because it returns cleaned content.",
  "Use firecrawl_crawl instead when content is needed from multiple pages on the same website.",
];

export const SCRAPE_PARAMETER_DESCRIPTIONS = {
  url: "The URL to scrape.",
  onlyMainContent: "Return only the main page content. Defaults to true.",
  waitFor:
    "Milliseconds to wait before capture, useful for JavaScript-heavy pages.",
  timeout: "Request timeout in milliseconds. Defaults to 30000.",
  includeMetadata:
    "Append page metadata to the markdown. Defaults to false; metadata remains available in tool details.",
};
