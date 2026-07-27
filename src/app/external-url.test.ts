import { describe, expect, it } from "vitest";
import { isAllowedExternalUrl } from "./external-url";

describe("external PDF URL allowlist", () => {
  it.each([
    "https://example.com/document",
    "http://example.com/",
    "mailto:reviewer@example.com?subject=PDF",
  ])("allows %s", (url) => {
    expect(isAllowedExternalUrl(url)).toBe(true);
  });

  it.each([
    "javascript:alert(document.domain)",
    "data:text/html,<script>alert(1)</script>",
    "file:///C:/Windows/win.ini",
    "shell:AppsFolder",
    "not a URL",
    "",
  ])("blocks %s", (url) => {
    expect(isAllowedExternalUrl(url)).toBe(false);
  });
});
