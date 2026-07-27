import { describe, expect, it } from "vitest";
import type { AnnotationRecord } from "./contracts";
import { assertAnnotationUpdateAllowed, isAnnotationLocked } from "./annotation-update-policy";

const before: AnnotationRecord = {
  id: "a1",
  pdfName: "stable",
  sourceObjectNumber: 12,
  sourceIndex: 1,
  pageIndex: 2,
  kind: "highlight",
  rect: [10, 20, 30, 40],
  quadPoints: [[10, 40, 30, 40, 10, 20, 30, 20]],
  contents: "before",
  author: "author",
  subject: "subject",
  createdAt: "2026-07-20T00:00:00.000Z",
  modifiedAt: undefined,
  style: { color: [1, 1, 0], opacity: 1, lineWidth: 1 },
  flags: 4,
};

describe("annotation update policy", () => {
  it("allows review-field and modification-date updates", () => {
    expect(() => assertAnnotationUpdateAllowed(before, {
      ...before,
      contents: "after",
      author: "reviewer",
      subject: "reviewed",
      modifiedAt: "2026-07-22T00:00:00.000Z",
      style: { ...before.style, color: [0.2, 0.4, 0.8], opacity: 0.45 },
    })).not.toThrow();
  });

  it("rejects identity, geometry, flags and non-editable style changes", () => {
    expect(() => assertAnnotationUpdateAllowed(before, { ...before, pageIndex: 3 })).toThrow();
    expect(() => assertAnnotationUpdateAllowed(before, { ...before, rect: [0, 0, 1, 1] })).toThrow();
    expect(() => assertAnnotationUpdateAllowed(before, { ...before, flags: 0 })).toThrow();
    expect(() => assertAnnotationUpdateAllowed(before, { ...before, style: { ...before.style, lineWidth: 4 } })).toThrow();
  });

  it("recognizes PDF read-only, locked and locked-contents flags", () => {
    expect(isAnnotationLocked(4)).toBe(false);
    expect(isAnnotationLocked(64)).toBe(true);
    expect(isAnnotationLocked(128)).toBe(true);
    expect(isAnnotationLocked(512)).toBe(true);
  });
});
