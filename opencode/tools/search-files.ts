import { tool, ToolContext } from "@opencode-ai/plugin";

// =============================================================================
// AGENT ACCESS CONTROL CONFIGURATION
// =============================================================================

const AST_PATTERN_AGENTS = new Set(["plan", "researcher", "reviewer"]);

// NOTE: Experimental tool, not sure how useful it is compared to grep.
export default tool({
  description: "Smart search tool. Finds code patterns using ast-grep.",
  args: {
    query: tool.schema
      .string()
      .describe("The string or regex pattern to search for."),
    path: tool.schema
      .string()
      .default(".")
      .describe("Directory or file to search (default: current directory)."),
    caseSensitive: tool.schema
      .boolean()
      .default(false)
      .describe("Force case sensitivity (default: false)."),
    fileType: tool.schema
      .enum(["ts", "py", "js"])
      .optional()
      .describe("Limit to file types: 'ts', 'py', 'js'."),
  },
  async execute(
    { query, path, caseSensitive, fileType },
    ctx: ToolContext,
  ) {
    const { agent } = ctx;

    // Check if query looks like an AST pattern (contains meta-variables like $VAR)
    const isAstPattern = query.includes("$");

    // =========================================================================
    // ACCESS CONTROL: Restrict AST patterns to trusted agents
    // =========================================================================
    if (isAstPattern && !AST_PATTERN_AGENTS.has(agent)) {
      ctx.metadata({ title: `[DENIED] AST search by ${agent}` });
      return `Access Denied: Agent '${agent}' is not authorized to use AST patterns.\nAllowed agents: ${[...AST_PATTERN_AGENTS].join(", ")}`;
    }

    ctx.metadata({ title: `Search by ${agent}` });

    try {
      let cmd: string[];

      // Search with ast-grep (Best for structured code search - prioritized for patterns)
      // ast-grep provides better semantic code understanding
      if (Bun.which("ast-grep") && (caseSensitive || isAstPattern || fileType)) {
        cmd = ["ast-grep", "-p", query];
        if (fileType) cmd.push("-l", fileType);
        cmd.push(path);
      } else {
        return "Search Error: ast-grep is not installed or not in PATH.";
      }

      const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
      const output = await new Response(proc.stdout).text();

      const lines = output.trim().split("\n");

      // Safety limit to save context tokens
      if (lines.length > 100) {
        return `${lines.slice(0, 100).join("\n")}\n... (and ${lines.length - 100} more matches)`;
      }

      return lines.length > 0 && lines[0] !== "" ? output : "No matches found.";
    } catch (e) {
      return `Search Error: ${e instanceof Error ? e.message : String(e)}`;
    }
  },
});