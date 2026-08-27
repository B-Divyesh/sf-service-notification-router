import { describe, expect, it } from "vitest";
import { escapeHtml, formatDate } from "./utils";

describe("presentation helpers", () => {
  it("escapes untrusted booking values", () => expect(escapeHtml('<img src=x onerror="x">')).toBe("&lt;img src=x onerror=&quot;x&quot;&gt;"));
  it("keeps an unreadable scheduler date legible", () => expect(formatDate("not-a-date")).toBe("not-a-date"));
});
