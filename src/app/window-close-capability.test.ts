import { describe, expect, it } from "vitest";
import capability from "../../src-tauri/capabilities/default.json";

describe("desktop window close capability", () => {
  it("allows onCloseRequested to destroy the approved window", () => {
    expect(capability.permissions).toContain("core:window:allow-destroy");
  });
});
