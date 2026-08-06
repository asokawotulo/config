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

## Shared UI

Reusable extension UI belongs in `shared/ui/`. Keep presentation contracts such as dialog framing, overlay defaults, and common component lifecycle behavior there; keep extension-specific state and actions inside each extension directory.

Custom dialogs should use the shared dialog frame and overlay helpers so popup backgrounds, borders, spacing, hints, and configurable navigation keys stay consistent.

## Dynamic workflows

`extensions/dynamic-workflows/` provides editable, role-based Pi subagent DAGs with parallel execution, command approval through `cc-safety-net explain --json`, and live inspection via `/workflows`. It prefers persistent detached interactive Pi sessions under zmx (including Supacode's bundled zmx, without invoking the Supacode CLI) and falls back to embedded execution with a persistent transcript. Child transcripts stay in session artifacts; only bounded final summaries and aggregated nested usage return to the parent. Role definitions live in `roles/*.md`; see the extension README for workflow, context, permission, backend, and artifact contracts.
