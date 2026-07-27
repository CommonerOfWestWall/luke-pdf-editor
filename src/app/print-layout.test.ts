import { describe, expect, it } from "vitest";
import type { AnnotationRecord } from "../pdf/contracts";
import { layoutPrintComments, parsePageRange } from "./print-layout";

function note(id: string, y: number): AnnotationRecord {
  return {
    id,
    pageIndex: 0,
    kind: "note",
    rect: [50, y, 70, y + 20],
    contents: `批注 ${id}`,
    author: "测试",
    subject: "便签",
    style: { color: [1, 1, 0], opacity: 1, lineWidth: 1 },
    flags: 4,
  };
}

describe("parsePageRange", () => {
  it("deduplicates and sorts comma-separated ranges", () => {
    expect(parsePageRange("3, 1-2, 2", 5)).toEqual([0, 1, 2]);
  });

  it("rejects invalid pages", () => {
    expect(() => parsePageRange("0-2", 5)).toThrow();
    expect(() => parsePageRange("6", 5)).toThrow();
  });
});

describe("layoutPrintComments", () => {
  it("keeps comment bars outside each other while preserving anchor order", () => {
    const result = layoutPrintComments([note("a", 700), note("b", 690), note("c", 680)], 800);
    expect(result.map(({ annotation }) => annotation.id)).toEqual(["a", "b", "c"]);
    for (let index = 1; index < result.length; index += 1) {
      expect(result[index].top).toBeGreaterThanOrEqual(result[index - 1].top + result[index - 1].height + 8);
    }
  });

  it("compresses dense comments so every bar stays on the page without overlap", () => {
    const pageHeight = 800;
    const padding = 16;
    const result = layoutPrintComments(
      Array.from({ length: 30 }, (_, index) => note(String(index), 760 - index * 2)),
      pageHeight,
    );

    expect(result).toHaveLength(30);
    expect(result[0].top).toBeGreaterThanOrEqual(padding);
    for (let index = 1; index < result.length; index += 1) {
      expect(result[index].top).toBeGreaterThanOrEqual(
        result[index - 1].top + result[index - 1].height,
      );
    }
    const last = result.at(-1)!;
    expect(last.top + last.height).toBeLessThanOrEqual(pageHeight - padding + 0.001);
  });
});
