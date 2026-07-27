import { describe, expect, it } from "vitest";
import type { AnnotationRecord } from "../pdf/contracts";
import {
  annotationColorToHex,
  annotationToDraft,
  createAnnotationUpdate,
  filterAndSortAnnotations,
  findCreatedAnnotation,
  groupAnnotationsByPage,
  hexToAnnotationColor,
  type AnnotationDraft,
} from "./annotation-panel";

function annotation(overrides: Partial<AnnotationRecord> = {}): AnnotationRecord {
  return {
    id: "annotation-1",
    pdfName: "stable-name",
    sourceObjectNumber: 42,
    sourceIndex: 3,
    pageIndex: 0,
    kind: "highlight",
    rect: [10, 20, 80, 32],
    quadPoints: [[10, 32, 80, 32, 10, 20, 80, 20]],
    contents: "原批注",
    author: "鲁科look AI",
    subject: "校对",
    createdAt: "2026-07-20T10:00:00.000Z",
    modifiedAt: undefined,
    style: { color: [1, 0.8, 0], opacity: 0.7, lineWidth: 1 },
    flags: 4,
    replyTo: "parent",
    status: "none",
    ...overrides,
  };
}

describe("annotation panel model", () => {
  it("combines scope, kind and case-insensitive text filters without mutating input", () => {
    const records = [
      annotation({ id: "page-2-note", pageIndex: 1, kind: "note", author: "Alice", contents: "复核结论" }),
      annotation({ id: "page-1-hit", pageIndex: 0, author: "LUKE", contents: "重点复核" }),
      annotation({ id: "page-1-other", pageIndex: 0, author: "Bob", contents: "跳过" }),
    ];

    const result = filterAndSortAnnotations(records, {
      scope: "page",
      pageIndex: 0,
      kind: "highlight",
      query: "luke 重点",
    });

    expect(result.map(({ id }) => id)).toEqual(["page-1-hit"]);
    expect(records.map(({ id }) => id)).toEqual(["page-2-note", "page-1-hit", "page-1-other"]);
  });

  it("sorts by page, top-to-bottom geometry and stable id when dates are absent", () => {
    const result = filterAndSortAnnotations([
      annotation({ id: "later-page", pageIndex: 2, rect: [0, 700, 20, 720] }),
      annotation({ id: "lower", pageIndex: 0, rect: [0, 100, 20, 120] }),
      annotation({ id: "upper-b", pageIndex: 0, rect: [0, 700, 20, 720] }),
      annotation({ id: "upper-a", pageIndex: 0, rect: [0, 700, 20, 720] }),
    ], { scope: "all", pageIndex: 0, kind: "all", query: "" });

    expect(result.map(({ id }) => id)).toEqual(["upper-a", "upper-b", "lower", "later-page"]);
  });

  it("creates a narrow update while preserving PDF identity and geometry", () => {
    const before = annotation();
    const draft: AnnotationDraft = {
      contents: "修改后",
      author: "审读员",
      subject: "已复核",
      color: "#3366cc",
      opacity: 0.45,
    };

    const after = createAnnotationUpdate(before, draft, "2026-07-22T04:00:00.000Z");

    expect(after).toEqual({
      ...before,
      contents: "修改后",
      author: "审读员",
      subject: "已复核",
      modifiedAt: "2026-07-22T04:00:00.000Z",
      style: { ...before.style, color: [0.2, 0.4, 0.8], opacity: 0.45 },
    });
    expect(after.rect).toBe(before.rect);
    expect(after.quadPoints).toBe(before.quadPoints);
  });

  it("does not rewrite an unchanged source color space during a text-only edit", () => {
    const color = [0.1, 0.2, 0.3, 0.4] as const;
    const before = annotation({ style: { color, opacity: 0.7, lineWidth: 1 } });
    const draft = { ...annotationToDraft(before), contents: "只修改文字" };

    const after = createAnnotationUpdate(before, draft);

    expect(after.style.color).toBe(color);
  });

  it("converts PDF grayscale, RGB and CMYK colors to an editable RGB hex value", () => {
    expect(annotationColorToHex([])).toBe("#f4bf36");
    expect(annotationColorToHex([0.5])).toBe("#808080");
    expect(annotationColorToHex([1, 0.5, 0])).toBe("#ff8000");
    expect(annotationColorToHex([0, 1, 1, 0])).toBe("#ff0000");
    expect(hexToAnnotationColor("#3366cc")).toEqual([0.2, 0.4, 0.8]);
  });

  it("groups a sorted list into page sections with counts and labels", () => {
    const records = filterAndSortAnnotations([
      annotation({ id: "p3-a", pageIndex: 2 }),
      annotation({ id: "p1-a", pageIndex: 0 }),
      annotation({ id: "p1-b", pageIndex: 0 }),
      annotation({ id: "p3-b", pageIndex: 2 }),
    ], { scope: "all", pageIndex: 0, kind: "all", query: "" });
    const labels = new Map([[0, "i"], [2, "iii"]]);

    const groups = groupAnnotationsByPage(records, (pageIndex) => labels.get(pageIndex));

    expect(groups.map(({ pageIndex, label, count }) => [pageIndex, label, count])).toEqual([
      [0, "i", 2],
      [2, "iii", 2],
    ]);
    expect(groups[0].annotations.map(({ id }) => id)).toEqual(["p1-a", "p1-b"]);
  });

  it("falls back to the numeric page label when none is provided", () => {
    const groups = groupAnnotationsByPage([annotation({ id: "only", pageIndex: 4 })], () => undefined);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe("5");
    expect(groups[0].count).toBe(1);
  });

  it("finds a newly created annotation even when MuPDF assigns a different runtime id", () => {
    const before = [annotation({ id: "existing", kind: "highlight" })];
    const requested = annotation({
      id: "temporary-client-id",
      kind: "underline",
      rect: [15, 25, 85, 37],
      quadPoints: [[15, 37, 85, 37, 15, 25, 85, 25]],
    });
    const created = { ...requested, id: "mupdf-runtime-id" };

    expect(findCreatedAnnotation(before, [...before, created], requested)?.id)
      .toBe("mupdf-runtime-id");
  });
});
