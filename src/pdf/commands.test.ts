import { describe, expect, it } from "vitest";
import { applyAnnotationCommand, invertAnnotationCommand } from "./commands";
import type { AnnotationCommand, AnnotationRecord } from "./contracts";

const note: AnnotationRecord = {
  id: "note-1",
  pageIndex: 0,
  kind: "note",
  rect: [10, 10, 30, 30],
  contents: "Review this",
  author: "Tester",
  subject: "Note",
  style: { color: [1, 0.8, 0], opacity: 1, lineWidth: 1 },
  flags: 4,
};

describe("annotation commands", () => {
  it("can undo a create", () => {
    const created = applyAnnotationCommand([], { type: "create", annotation: note });
    const reverted = applyAnnotationCommand(created, invertAnnotationCommand({ type: "create", annotation: note }));
    expect(reverted).toEqual([]);
  });

  it("reverses a batch in inverse order", () => {
    const updated = { ...note, contents: "Updated" };
    const command: AnnotationCommand = {
      type: "batch",
      commands: [
        { type: "create", annotation: note },
        { type: "update", before: note, after: updated },
      ],
    };
    const result = applyAnnotationCommand(applyAnnotationCommand([], command), invertAnnotationCommand(command));
    expect(result).toEqual([]);
  });
});
