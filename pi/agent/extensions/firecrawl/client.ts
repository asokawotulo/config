import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Firecrawl } from "firecrawl";

function readEnvValue(name: string): string | undefined {
  const environmentValue = process.env[name];
  if (environmentValue) return environmentValue;

  const envPath = join(homedir(), ".pi", "agent", ".env");
  let envText: string;
  try {
    envText = readFileSync(envPath, "utf8");
  } catch {
    return undefined;
  }

  for (const line of envText.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const match = trimmed.match(
      /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/,
    );
    if (!match || match[1] !== name) continue;

    const value = match[2]?.trim() ?? "";
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      return value.slice(1, -1);
    }
    return value.replace(/\s+#.*$/, "");
  }

  return undefined;
}

export function createFirecrawlClient(): Firecrawl {
  const apiKey = readEnvValue("FIRECRAWL_API_KEY");
  if (!apiKey) {
    throw new Error(
      "Missing FIRECRAWL_API_KEY in the environment or ~/.pi/agent/.env",
    );
  }
  return new Firecrawl({ apiKey });
}
