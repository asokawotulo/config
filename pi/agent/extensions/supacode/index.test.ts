import { describe, expect, test } from "bun:test";
import { notifyField } from "./index.ts";

describe("Supacode notification fields", () => {
  test("truncates at a UTF-8 character boundary", () => {
    const decoded = Buffer.from(notifyField("a😀b", 4), "base64").toString(
      "utf8",
    );

    expect(decoded).toBe("a");
    expect(decoded).not.toContain("�");
    expect(Buffer.byteLength(decoded, "utf8")).toBeLessThanOrEqual(4);
  });
});
