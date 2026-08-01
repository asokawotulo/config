# Firecrawl extension

Registers three Pi tools:

- `firecrawl_search` — search the web, news, or images
- `firecrawl_scrape` — fetch one page as cleaned markdown
- `firecrawl_crawl` — crawl multiple pages from one website

Set `FIRECRAWL_API_KEY` in the process environment or in
`~/.pi/agent/.env`:

```sh
FIRECRAWL_API_KEY=fc-...
```

## Shared cache

Results are stored under `~/.firecrawl/results/v1` by default. Set
`FIRECRAWL_CACHE_DIR` to override the `results` directory. Search entries
expire after 6 hours; scrape and crawl entries expire after 7 days.

Every tool accepts `cacheMode`:

- `prefer-cache` (default) uses a valid cache entry and otherwise fetches it.
- `refresh` fetches and replaces the entry.
- `no-store` neither reads nor writes the shared cache.

Each request directory contains `metadata.json`, `request.json`,
`details.json`, and the model-facing `output.json` or `output.md`. Crawl
entries also expose individual markdown documents under `documents/`.
