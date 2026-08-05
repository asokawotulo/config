---
name: diff
description: Formats focused Before/After code changes as responsive diff fences. Use when presenting proposed changes, implementation plans, or concise code comparisons.
---

# Diff

Format Before/After comparisons as focused unified diff fences. Pi renders these as responsive side-by-side panes when space permits and falls back to unified diff rendering at narrow widths.

## Standard Format

````markdown
`optional/repository/path.ext`:

- Concise description of the change.
- Rationale or symbol context.

```diff:<optional-language>
 unchanged context
-before
+after
```
````

Each surrounding element is independently optional:

- **File path:** Include a verified repository-relative path alone in inline code followed by a colon. Omit it for conceptual changes or unresolved new-file locations; never invent a path or line number.
- **Description or rationale:** Include a short bullet list only when it adds useful context beyond the diff. Identify the relevant symbol when that makes the location clearer.
- **Language:** Use `diff:<language>` to preserve normal syntax highlighting for the inherited language. Use plain `diff` when no language is useful or known. Unsupported inherited languages safely fall back to the normal code-block foreground.

When present, leave one blank line between the path, bullet list, and fence.

## Diff Rules

- Put the current form on `-` lines and the intended form on `+` lines.
- Keep short unchanged excerpts from the existing file on lines beginning with one space.
- Keep replacement runs adjacent so corresponding lines align across the panes.
- For an addition, use `- (not present)` followed by the proposed `+` line.
- For a removal, show the current `-` line followed by `+ (removed)`.
- Show focused deltas, not complete patches or large files.
- Ground syntax in inspected files. If it cannot be confirmed, write `illustrative pseudocode` immediately before the fence.
- Include the diff directly in the streamed Markdown response; do not use a tool to emit it.

## Examples

### Path, rationale, and inherited language

````markdown
`src/config.ts`:

- Increase the default timeout while preserving retry behavior.

```diff:typescript
 export const config = {
-  timeout: 1_000,
+  timeout: 5_000,
   retries: 3,
 };
```
````

### Minimal conceptual change

````markdown
```diff
-manual retries
+bounded automatic retries
```
````

### Addition

````markdown
`src/config.ts`:

- Introduce a shared timeout constant.

```diff:typescript
+export const DEFAULT_TIMEOUT = 5_000;
```
````

### Removal

````markdown
`src/legacy.ts`:

```diff:typescript
-export const LEGACY_TIMEOUT = 1_000;
```
````

### Complicated replacement

Use enough existing context to locate a multi-line change while keeping the excerpt short:

````markdown
`src/client.ts`:

- Add request timeouts and typed HTTP error handling.
- Preserve the existing JSON response flow in `request`.

```diff:typescript
 export async function request(input: RequestInfo) {
-  const response = await fetch(input);
-  return response.json();
+  const response = await fetch(input, {
+    signal: AbortSignal.timeout(5_000),
+  });
+
+  if (!response.ok) {
+    throw new HttpError(response.status);
+  }
+
+  return response.json() as Promise<ApiResponse>;
 }
```
````
