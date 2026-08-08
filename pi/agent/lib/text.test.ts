import { describe, expect, test } from "bun:test";
import { sanitizeTerminalText, utf8BytePrefix } from "./text.ts";

describe("sanitizeTerminalText", () => {
  test("removes terminal sequences and normalizes controls and whitespace", () => {
    expect(sanitizeTerminalText("  \u001b[31mred\u001b[0m\n\ttext  ")).toBe("red text");
    expect(sanitizeTerminalText("before\u001b]0;secret title\u0007after")).toBe("beforeafter");
    expect(sanitizeTerminalText("safe\u202E hidden\u200B text\uFEFF")).toBe("safe hidden text");
  });

  test("leaves ordinary unicode text intact", () => {
    expect(sanitizeTerminalText("hello 🙂 café")).toBe("hello 🙂 café");
  });
});

describe("utf8BytePrefix", () => {
  test("returns the longest complete UTF-8 prefix", () => {
    expect(utf8BytePrefix("ab🙂é", 0)).toBe("");
    expect(utf8BytePrefix("ab🙂é", 2)).toBe("ab");
    expect(utf8BytePrefix("ab🙂é", 5)).toBe("ab");
    expect(utf8BytePrefix("ab🙂é", 6)).toBe("ab🙂");
    expect(utf8BytePrefix("ab🙂é", 8)).toBe("ab🙂é");
  });

  test("handles fractional, invalid, and unbounded budgets", () => {
    expect(utf8BytePrefix("abc", 2.9)).toBe("ab");
    expect(utf8BytePrefix("abc", -1)).toBe("");
    expect(utf8BytePrefix("abc", Number.NaN)).toBe("");
    expect(utf8BytePrefix("🙂", Infinity)).toBe("🙂");
  });
});
