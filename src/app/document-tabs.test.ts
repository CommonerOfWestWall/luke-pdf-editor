import { describe, expect, it } from "vitest";
import { nextTabAfterClose } from "./document-tabs";

describe("nextTabAfterClose", () => {
  it("prefers the tab to the right, then the tab to the left", () => {
    expect(nextTabAfterClose(["a", "b", "c"], "b")).toBe("c");
    expect(nextTabAfterClose(["a", "b"], "b")).toBe("a");
    expect(nextTabAfterClose(["a"], "a")).toBeNull();
  });
});
