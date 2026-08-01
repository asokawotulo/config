import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  truncateHead,
} from "@earendil-works/pi-coding-agent";
import type { FirecrawlOperation, OutputFormat } from "./types.ts";

export function stringify(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export async function formatForModel(options: {
  operation: FirecrawlOperation;
  output: string;
  outputFormat: OutputFormat;
  storedOutputPath?: string;
}): Promise<string> {
  const truncation = truncateHead(options.output, {
    maxBytes: DEFAULT_MAX_BYTES,
    maxLines: DEFAULT_MAX_LINES,
  });
  if (!truncation.truncated) return options.output;

  let outputPath = options.storedOutputPath;
  if (!outputPath) {
    const directory = await mkdtemp(join(tmpdir(), "pi-firecrawl-"));
    outputPath = join(directory, `${options.operation}.${options.outputFormat}`);
    await writeFile(outputPath, options.output, { mode: 0o600 });
  }

  return `${truncation.content}\n\n[Output truncated: ${truncation.outputLines} of ${truncation.totalLines} lines (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}). Full output saved to: ${outputPath}]`;
}
