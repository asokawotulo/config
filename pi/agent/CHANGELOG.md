# Changelog

## 2026-08-21 12:39
### Added
- guardrails: protected main-host and workflow-child Bash/Shell calls with serialized CC Safety Net approval and session audit browsing
### Changed
- dynamic workflows: delegated command policy to Guardrails while retaining fail-closed child transport and per-run decision records
- command safety: upgraded and pinned CC Safety Net 2.0.8

## 2026-08-20 23:38
### Added
- planner skill: made plans execution-oriented, evidence-grounded, adaptive in structure, and concise by default

## 2026-08-20 23:31
### Added
- ask user: added multiline Markdown option descriptions with a responsive master-detail layout and scrollable detail pane

## 2026-08-18 12:40
### Added
- search tools: added pi-fff in override mode to replace Pi's default find and grep tools with frecency and history support

## 2026-08-17 21:44
### Added
- compatibility: updated Pi dependencies and custom extensions for Pi 0.84.2

## 2026-08-13 19:06
### Added
- diff skill: documented code, call-tree, control-flow, and file-tree diff formats

## 2026-08-12 19:53
### Added
- sidebar: displayed cache-hit token usage reported by Supacode

## 2026-08-10 14:22
### Added
- ask user: allowed navigating back to completed questions to revise answers

## 2026-08-09 14:55
### Fixed
- sidebar: corrected cursor selection when interacting with sidebar content

## 2026-08-09 13:35
### Fixed
- dynamic workflows: returned confirmation validation failures to the model for correction

## 2026-08-09 00:20
### Added
- dynamic workflows: displayed each agent's thinking level in the confirmation dialog

## 2026-08-08 18:51
### Added
- shared libraries: added reusable text and workflow-event validation
### Fixed
- markdown: preserved nested Markdown code fences
- firecrawl: hardened cache locking, errors, and concurrent access
- sidebar: hardened metadata collection and Git refresh handling
- dynamic workflows: stabilized execution, progress, output, and settlement handling
- ask user: preserved answers at narrow terminal widths
- session manager: made session paths and handling Unicode-safe
- supacode: made notification truncation Unicode-safe

## 2026-08-08 18:41
### Added
- prompts: added a reusable prompt template for designing dynamic workflows

## 2026-08-08 17:42
### Added
- plan prompt: refined planning instructions for implementation-ready handoffs

## 2026-08-08 17:39
### Added
- dynamic workflows: replaced the workflow editor with a confirmation graph and run, suggest, and cancel actions
- shared dialogs: added padded layouts and dialog-owned notification handling

## 2026-08-08 16:54
### Added
- prompts: added a reusable implementation-planning prompt template

## 2026-08-08 16:25
### Added
- UI customization: added Pi 0.84-compatible layout integration and keybindings
### Removed
- UI customization: removed obsolete mouse and scroll-state overrides superseded by Pi 0.84

## 2026-08-08 13:08
### Added
- diff rendering: added Pi 0.84.1 compatibility for Markdown and tool diff extensions

## 2026-08-08 00:20
### Added
- command safety: made CC Safety Net the sole command permission controller for dynamic workflows

## 2026-08-08 00:08
### Added
- tool diffs: rendered edit and write tool calls with the shared side-by-side diff view
### Fixed
- UI customization: optimized transcript scrolling and rendering performance

## 2026-08-07 12:32
### Added
- Supacode skills: updated CLI and deeplink guidance for current Supacode workflows

## 2026-08-07 01:04
### Added
- dynamic workflows: added child-agent observability, usage reporting, protocol events, and Zellij session integration
- sidebar: surfaced workflow execution state and agent activity

## 2026-08-06 17:01
### Added
- sidebar: color-coded context usage to make token pressure easier to identify

## 2026-08-06 13:23
### Added
- dynamic workflows: added static multi-agent workflow design, confirmation, permission checks, execution, and role support
- roles: added implementer, researcher, and reviewer definitions for workflow agents
- sidebar: integrated dynamic workflow status into the custom UI

## 2026-08-05 12:49
### Fixed
- diff rendering: wrapped long diff-block text without breaking side-by-side layouts

## 2026-08-04 23:14
### Added
- UI customization: added a custom metadata sidebar and floating text input

## 2026-08-04 17:58
### Added
- shared UI: extracted reusable dialog components for ask-user and session-manager extensions

## 2026-08-04 01:06
### Fixed
- theme: adjusted the diff background color for clearer contrast

## 2026-08-04 01:05
### Added
- diff rendering: highlighted byte-level changes within modified lines

## 2026-08-04 00:27
### Added
- session manager: added an interactive extension for browsing and managing Pi sessions

## 2026-08-04 00:07
### Added
- diff skill: extracted focused diff-formatting guidance into a reusable skill

## 2026-08-03 23:35
### Added
- diff rendering: supported optional language identifiers for syntax-highlighted diff blocks

## 2026-08-03 15:37
### Added
- markdown: added a custom Markdown code-block extension with responsive diff rendering
- planner skill: adapted the OpenCode planner into a read-only Pi planning skill

## 2026-08-02 11:51
### Added
- Brew: installed the Pi coding agent
- setup: linked the Pi agent configuration during machine setup
### Fixed
- settings: committed Pi settings instead of excluding them through `.gitignore`

## 2026-08-02 11:50
### Fixed
- theme: changed the user-message background color for improved readability

## 2026-08-01 20:05
### Added
- theme: added the Flatland Monokai Improved Pi theme

## 2026-08-01 19:56
### Added
- Firecrawl: added cached web search, page scraping, and site crawling tools

## 2026-08-01 19:25
### Added
- ask user: added interactive single-choice and multiple-choice questions
- Supacode: added Supacode integration, event handling, and CLI and deeplink skills
