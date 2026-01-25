import { tool, ToolContext } from "@opencode-ai/plugin";

// =============================================================================
// AGENT ACCESS CONTROL CONFIGURATION
// =============================================================================

// Paths that require elevated access (only certain agents can list)
const RESTRICTED_PATHS = [
  ".env",
  "secrets",
  ".ssh",
  "credentials",
  ".aws",
  "private",
];

function isRestrictedPath(path: string): boolean {
  const normalized = path.toLowerCase();
  return RESTRICTED_PATHS.some(
    (p) => normalized.includes(p) || normalized.endsWith(p)
  );
}

export default tool({
  description: "List files and directories. Uses 'tree' command if available.",
  args: {
    path: tool.schema
      .string()
      .default(".")
      .describe("The directory to list (default: current directory)."),
    style: tool.schema
      .enum(["simple", "long", "all", "tree"])
      .default("simple")
      .describe(
        "Output style: 'simple' (names only), 'long' (permissions/size), 'all' (includes hidden files), 'tree' (hierarchical view). Default: 'simple'.",
      ),
  },
  async execute({ path, style }, ctx: ToolContext) {
    const { agent } = ctx;

    // =========================================================================
    // ACCESS CONTROL: Restrict sensitive directories
    // =========================================================================
    if (isRestrictedPath(path)) {
      ctx.metadata({ title: `[DENIED] List ${path} by ${agent}` });
      return `Access Denied: Agent '${agent}' cannot list restricted path '${path}'`;
    }

    ctx.metadata({ title: `List ${path} by ${agent}` });

    try {
      const flags: string[] = [];

      switch (style) {
        case "simple":
          break;
        case "long":
          flags.push("-lh");
          break;
        case "all":
          flags.push("-lah");
          break;
        case "tree":
          return await Bun.$`tree -L 2 ${path}`.nothrow().text();
      }

      return await Bun.$`ls ${flags} ${path}`.nothrow().text();
    } catch (e: any) {
      return `List Error: ${e.stderr ? e.stderr.toString() : e.message}`;
    }
  },
});