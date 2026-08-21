# Guardrails

Guardrails is the command permission extension for the main Pi host and dynamic workflow children. It inspects agent-issued `bash` and `Shell` tool calls. User-entered `!` and `!!` commands are not intercepted.

## Command analysis

The extension invokes the agent package's pinned `cc-safety-net` binary as:

```sh
CC_SAFETY_NET_STRICT=1 cc-safety-net explain --json <command>
```

The subprocess has a 15-second timeout and a 2 MiB output limit. Missing binaries, malformed output, invalid configuration, cancellation, and analysis errors fail closed. Guardrails does not fall back to a binary on `PATH`.

Commands CC Safety Net allows run without a prompt or audit entry. A blocked command enters the host session's FIFO approval queue. The user may:

- **Allow once** for that tool call.
- **Edit command**, which analyzes the edited command again.
- **Deny**.

Headless sessions cannot approve blocked commands. The complete blocked interaction remains serialized until it reaches a final result, so concurrent subagents cannot overlap prompts or editors.

## Audit

Guardrails stores blocked, failed, denied, edited, and overridden decision chains as `guardrails:decision` custom entries in the Pi session. Clean automatic allows are omitted. Each retained chain contains the full command text, CC Safety Net reason, rule and segment, user actions, edited commands, and final outcome.

`/guardrails` reports the pinned analyzer status and browses retained decisions across every branch in the current session. In the TUI, a selected chain opens in a scrollable read-only overlay.

Full commands may contain secrets. Pi session files and dynamic workflow run artifacts must retain private file permissions.

## Child integration

`child.ts` exports the shared Bash/Shell hook. Dynamic workflows inject it into embedded children and into the detached child host. Dynamic workflows owns child request/response files and polling; the parent Guardrails extension owns analysis, approval, queueing, and session audit records.

A shell-capable dynamic workflow is rejected before confirmation when the parent Guardrails extension or pinned analyzer is unavailable. Read-only workflows do not require Guardrails.
