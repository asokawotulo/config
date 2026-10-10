---
name: tool-workflow
description: Batch tool calls and limit context growth. Use when composing codemode batches, filtering large tool results, or recovering from failed edit batches.
---

# Tool workflow

## Evidence before edits

Search for the relevant symbol or path, then read its current file range. Widen on a miss or when the surrounding contract is unclear. Whole-file reads are appropriate for small files used in full.

For GitLab comments and discussions, use the `gitlab-cli` skill's projection and pagination rules.

## Bounded batches

Batch independent reads, searches, and checks with `Promise.allSettled`. Label results by path or operation. Keep search-to-read and edit-to-verification steps sequential when later arguments depend on earlier results.

Project large JSON before returning it to Main. Return the fields needed for the decision, counts, and source identifiers. For diffs and logs, select relevant files or failure sections and retain a full-output path when available. Preserve full review-comment text. Report truncation, omitted items, and remaining pages; a partial result is not a complete review.

Check exit codes and schemas before treating output as data. Return failures alongside successful evidence, rather than turning a failed command into an empty result. Keep summaries compact enough that another broad read is unnecessary.

Use Pi tools through native calls or `codemode`. Reserve `fabric_exec` for Fabric operations; `pi.*` and `extensions.*` are unavailable there in orchestration-only mode.

## Edit recovery

Build replacements from the latest file snapshot. Each `oldText` must match once. Add enough nearby text to distinguish repeated statements. Combine disjoint replacements for one file into one edit call; merge overlapping or adjacent replacements.

Sequence mutations to the same file. Parallelize edits only across independent files. A failed batch may already have applied earlier calls.

After a failure, inspect which calls succeeded, re-read the affected ranges, and rebuild only the unapplied changes against current text. Verify the final file and run the narrowest check that proves the requested behavior.

Done when the relevant evidence is complete, every requested replacement is verified in current files, and failures or remaining checks are explicit.
