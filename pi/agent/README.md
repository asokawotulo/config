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

Custom dialogs should use the shared dialog frame and `showDialog` overlay helper so popup backgrounds, borders, spacing, hints, configurable navigation keys, and once-only user notifications stay consistent.

## Guardrails

`extensions/guardrails/` inspects agent-issued Bash/Shell commands in the main host and workflow children through the pinned CC Safety Net CLI. It owns serialized allow-once/edit/deny prompts, fails closed when analysis or approval is unavailable, stores blocked decision chains in Pi sessions, and exposes `/guardrails` for status and audit inspection.

## Dynamic workflows

`extensions/dynamic-workflows/` provides role-based Pi subagent DAGs with Mermaid confirmation, model-mediated free-text revisions, parallel execution, Guardrails child transport, and live inspection via `/workflows`. It prefers persistent detached interactive Pi sessions under zmx (including Supacode's bundled zmx, without invoking the Supacode CLI) and falls back to embedded execution with a persistent transcript. Child transcripts stay in session artifacts; only bounded final summaries and aggregated nested usage return to the parent. Role definitions live in `roles/*.md`; see the extension README for workflow, context, Guardrails, backend, and artifact contracts.
