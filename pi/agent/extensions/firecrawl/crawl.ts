import { Data, Effect, Exit } from "effect";
import type { CrawlJob, CrawlOptions, Firecrawl } from "firecrawl";

export type CrawlClient = Pick<
  Firecrawl,
  "startCrawl" | "getCrawlStatus" | "cancelCrawl"
>;

export class FirecrawlRequestError extends Data.TaggedError(
  "FirecrawlRequestError",
)<{
  readonly message: string;
  readonly cause: unknown;
}> {}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function request<T>(run: () => Promise<T>) {
  return Effect.tryPromise({
    try: run,
    catch: (cause) =>
      new FirecrawlRequestError({ message: errorMessage(cause), cause }),
  });
}

function pollCrawl(
  client: CrawlClient,
  jobId: string,
): Effect.Effect<CrawlJob, FirecrawlRequestError> {
  return request(() => client.getCrawlStatus(jobId)).pipe(
    Effect.flatMap((job) =>
      job.status === "scraping"
        ? Effect.sleep("2 seconds").pipe(
            Effect.flatMap(() => Effect.suspend(() => pollCrawl(client, jobId))),
          )
        : Effect.succeed(job),
    ),
  );
}

/** Cancel the remote job whenever polling does not finish successfully. */
export function crawlEffect(
  client: CrawlClient,
  url: string,
  options: CrawlOptions,
) {
  return Effect.acquireUseRelease(
    request(() => client.startCrawl(url, options)),
    (job) => pollCrawl(client, job.id),
    (job, exit) =>
      Exit.isSuccess(exit)
        ? Effect.void
        : request(() => client.cancelCrawl(job.id)).pipe(
            Effect.timeout("10 seconds"),
            Effect.ignore,
          ),
  );
}
