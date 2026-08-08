/** Remove terminal escape/control sequences and normalize text to one display-safe line. */
export function sanitizeTerminalText(value: string): string {
  return value
    .replace(/\u001B\][^\u0007]*(?:\u0007|\u001B\\)/g, "")
    .replace(/\u001B(?:\[[0-?]*[ -/]*[@-~]|[@-_])/g, "")
    .replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Return the longest prefix whose UTF-8 encoding fits within maxBytes. */
export function utf8BytePrefix(value: string, maxBytes: number): string {
  if (maxBytes === Infinity) return value;
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) return "";

  const budget = Math.floor(maxBytes);
  const encoder = new TextEncoder();
  let bytes = 0;
  let codeUnits = 0;

  for (const character of value) {
    const characterBytes = encoder.encode(character).byteLength;
    if (bytes + characterBytes > budget) break;
    bytes += characterBytes;
    codeUnits += character.length;
  }

  return value.slice(0, codeUnits);
}
