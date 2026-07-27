import { describe, expect, it } from "vitest";
import { isJournalDirty, journalKey } from "./journal-state";

describe("journal save points", () => {
  it("recognizes undo and redo around the exact saved operation", () => {
    const steps = ["annotation:create:1"];
    const savedKey = journalKey({ position: 1, steps });

    expect(isJournalDirty({ position: 0, steps }, savedKey)).toBe(true);
    expect(isJournalDirty({ position: 1, steps }, savedKey)).toBe(false);
  });

  it("does not mistake a new history branch at the same depth for the saved state", () => {
    const savedKey = journalKey({ position: 1, steps: ["annotation:create:1"] });

    expect(
      isJournalDirty({ position: 1, steps: ["annotation:create:2"] }, savedKey),
    ).toBe(true);
  });
});
