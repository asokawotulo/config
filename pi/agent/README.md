# agent

To install dependencies:

```bash
bun install
```

To run checks and tests:

```bash
bun run check
bun test
```

## Fabric

`settings.json` loads Fabric, pi-fff and the MCP adapter without version pins. Unpinning does not upgrade the installed packages; run compatibility tests after package updates. `fabric.json` selects full code mode with TypeScript/QuickJS, explicit risk approvals, read-only worker defaults and seven-day one-shot artifact retention. Existing Pi auto-compaction remains disabled.

Use `/skill:fabric-workflow` for an explicitly requested workflow and `/fabric` for activity and child conversations. Advanced Fabric skills remain user-invoked; do not copy their implementation into local skills. Research and review workers use `read`, `grep`, `find`, and `ls`. Add mutation/shell tools explicitly only for implementation workers. Old `roles/*.md` files are retained but Fabric does not enforce them. Reviewers that need higher reasoning should explicitly request `thinking: "high"`. Partition concurrent edits by file or use worktrees.

Use `pi.find` and `pi.grep` inside `fabric_exec` for FFF search. Fabric captures the overrides, extended schemas and prompt guidance. `pi.read` remains Pi's reader. FFF cursors belong to their originating process; do not transfer them between workers. Leave `PI_FFF_MULTIGREP` unset unless specifically testing that opt-in tool. Keep FFF mode `override`; a resumed session's saved `/fff-mode` can override startup settings.

Fabric recall returns historical evidence, not proof about current files. Follow source pointers and verify the current working tree before acting on an earlier conclusion.

## Retained extensions

- `ask-user`: questionnaires, kept directly visible.
- `firecrawl`: web search/scraping and shared cache, with Fabric network approval.
- `session-manager`: rename, delete and resume Pi sessions.
- `supacode`: presence and notifications.
- `ui-customization`: session metadata, Fabric worker activity and deduplicated Main/Subagent costs. Incomplete coverage is labeled Reported.
- `custom-markdown-code-blocks`: response diff fences and shared side-by-side rendering.
- `pi-mcp-adapter`: retained until required servers are verified with Fabric. Its tools and scripting skill still belong to the adapter, not Fabric's native MCP provider.

`tool-diffs` remains present but disabled. Fabric can capture its mutation executors, but it does not delegate nested diff rendering to our renderer. The offline probe verifies this boundary and its plain-text fallback. Markdown diff fences still use the retained shared side-by-side renderer.

The sidebar's Fabric section shows workers, costs, current tools, timing, model/thinking, call counts and actor ownership. Worker input/output and cache rows are intentionally omitted until reliable context and latest-prompt cache metrics are available; the main session metrics remain unchanged. A public Fabric component polls metadata without model turns; compact custom entries preserve costs across resume. `bun run test:fabric-cost` checks the ledger, and the UI suite covers its bridge and rendering. Missing history or unverified runner attribution is labeled incomplete rather than counted as zero.

`fabric.json` hides the duplicate above-editor Fabric widget with `ui.widget: "hidden"`. The dashboard and child conversations remain enabled. Run `/reload` after changing extension code, or restart Pi.

## Shared UI

Reusable extension UI belongs in `shared/ui/`. Keep presentation contracts such as dialog framing, overlay defaults, and common component lifecycle behavior there; keep extension-specific state and actions inside each extension directory.

Custom dialogs should use the shared dialog frame and `showDialog` overlay helper so popup backgrounds, borders, spacing, hints, configurable navigation keys, and once-only user notifications stay consistent.
