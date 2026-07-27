import { describe, expect, it } from "vitest";
import type { PdfQuad } from "./contracts";
import { markupContentsPreview, quadsForMarkupSelection, rectForQuads, type MarkupCharacter } from "./text-markup";

// 页面空间 y 轴向下：top < bottom；quad 顺序为 ul、ur、ll、lr。
function character(line: number, index: number, x0: number, x1: number, top = 88, bottom = 100, text = "字"): MarkupCharacter {
  return { line, index, text, quad: [x0, top, x1, top, x0, bottom, x1, bottom] };
}

describe("quadsForMarkupSelection", () => {
  it("merges a partial single-line selection into one quad spanning the run", () => {
    const quads = quadsForMarkupSelection([
      character(0, 3, 60, 72),
      character(0, 4, 72, 84),
      character(0, 5, 84, 96),
    ]);
    expect(quads).toEqual([[60, 88, 96, 88, 60, 100, 96, 100]]);
  });

  it("produces one quad per line in reading order for a multi-line selection", () => {
    const quads = quadsForMarkupSelection([
      character(0, 8, 96, 108),
      character(0, 9, 108, 120),
      character(1, 0, 48, 60, 108, 120),
      character(1, 1, 60, 72, 108, 120),
      character(1, 2, 72, 84, 108, 120),
    ]);
    expect(quads).toEqual([
      [96, 88, 120, 88, 96, 100, 120, 100],
      [48, 108, 84, 108, 48, 120, 84, 120],
    ]);
  });

  it("normalizes backwards selections (end-to-start) into reading order", () => {
    const backwards = quadsForMarkupSelection([
      character(1, 1, 60, 72, 108, 120),
      character(1, 0, 48, 60, 108, 120),
      character(0, 9, 108, 120),
      character(0, 8, 96, 108),
    ]);
    const forwards = quadsForMarkupSelection([
      character(0, 8, 96, 108),
      character(0, 9, 108, 120),
      character(1, 0, 48, 60, 108, 120),
      character(1, 1, 60, 72, 108, 120),
    ]);
    expect(backwards).toEqual(forwards);
  });

  it("keeps angled baselines inside the union quad instead of dropping characters", () => {
    const quads = quadsForMarkupSelection([
      { line: 0, index: 0, text: "a", quad: [10, 88, 22, 86, 10, 100, 22, 98] },
      { line: 0, index: 1, text: "b", quad: [22, 86, 34, 84, 22, 98, 34, 96] },
    ]);
    expect(quads).toEqual([[10, 84, 34, 84, 10, 100, 34, 100]]);
  });

  it("returns an empty array for empty selections", () => {
    expect(quadsForMarkupSelection([])).toEqual([]);
  });
});

describe("rectForQuads", () => {
  it("unions quads into a bounding rect", () => {
    const quads: PdfQuad[] = [
      [96, 88, 120, 88, 96, 100, 120, 100],
      [48, 108, 84, 108, 48, 120, 84, 120],
    ];
    expect(rectForQuads(quads)).toEqual([48, 88, 120, 120]);
  });

  it("rejects empty input", () => {
    expect(() => rectForQuads([])).toThrow();
  });
});

describe("markupContentsPreview", () => {
  it("collapses whitespace and trims", () => {
    expect(markupContentsPreview("  第一段\n\n第二段\t ")).toBe("第一段 第二段");
  });

  it("truncates long selections with an ellipsis", () => {
    const long = "字".repeat(120);
    const preview = markupContentsPreview(long, 40);
    expect(preview).toHaveLength(40);
    expect(preview.endsWith("…")).toBe(true);
  });
});
