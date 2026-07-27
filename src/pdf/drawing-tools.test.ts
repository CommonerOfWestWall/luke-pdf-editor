import { describe, expect, it } from "vitest";
import { derivePageCoordinateSpace, pagePointToPdf, pdfPointToPage } from "./coordinates";
import {
  buildDrawingGeometry,
  normalizePointerPressure,
  sampleStroke,
  type PointerSample,
} from "./drawing-tools";

function sample(x: number, y: number, pressure = 0.5): PointerSample {
  return { point: [x, y], pressure };
}

describe("drawing tool input", () => {
  it("normalizes mouse and pen pressure without propagating invalid values", () => {
    expect(normalizePointerPressure("mouse", 0)).toBe(0.5);
    expect(normalizePointerPressure("mouse", 1)).toBe(0.5);
    expect(normalizePointerPressure("pen", -1)).toBe(0);
    expect(normalizePointerPressure("pen", 0.35)).toBe(0.35);
    expect(normalizePointerPressure("pen", 2)).toBe(1);
    expect(normalizePointerPressure("pen", Number.NaN)).toBe(0.5);
  });

  it("reduces dense stroke samples while preserving the final point", () => {
    const input = [
      sample(0, 0),
      sample(0.1, 0.1),
      sample(0.2, 0.2),
      sample(2, 2),
      sample(2.1, 2.1, 0.8),
    ];

    expect(sampleStroke(input, 0.5)).toEqual([
      sample(0, 0),
      sample(2, 2),
      sample(2.1, 2.1, 0.8),
    ]);
  });

  it("collapses identical samples and rejects an ink stroke without two distinct points", () => {
    expect(sampleStroke([sample(4, 4), sample(4, 4, 0.8)], 0.5)).toEqual([
      sample(4, 4, 0.8),
    ]);
    expect(() => buildDrawingGeometry("ink", [[4, 4], [4, 4]])).toThrow(/至少需要 2 个不同点/);
  });

  it("normalizes reverse rectangle drags and preserves line direction", () => {
    expect(buildDrawingGeometry("rectangle", [[90, 70], [10, 20]])).toEqual({
      rect: [10, 20, 90, 70],
    });
    expect(buildDrawingGeometry("ellipse", [[90, 70], [10, 20]])).toEqual({
      rect: [10, 20, 90, 70],
    });
    expect(buildDrawingGeometry("arrow", [[90, 70], [10, 20]])).toEqual({
      rect: [10, 20, 90, 70],
      points: [[90, 70], [10, 20]],
    });
  });

  it("validates visible geometry for every point-based drawing tool", () => {
    expect(() => buildDrawingGeometry("line", [[0, 0], [Number.NaN, 10]])).toThrow(/有限坐标/);
    expect(() => buildDrawingGeometry("line", [[0, 0], [0.1, 0.1]])).toThrow(/过短/);
    expect(() => buildDrawingGeometry("rectangle", [[0, 0], [10, 0.1]])).toThrow(/过小/);
    expect(() => buildDrawingGeometry("ellipse", [[0, 0], [0.1, 10]])).toThrow(/过小/);
    expect(() => buildDrawingGeometry("polygon", [[0, 0], [10, 0], [0, 0]])).toThrow(/至少需要 3 个不同顶点/);
    expect(() => buildDrawingGeometry("polygon", [[0, 0], [5, 0], [10, 0]])).toThrow(/面积过小/);
    expect(() => buildDrawingGeometry("polyline", [[0, 0], [0, 0]])).toThrow(/至少需要 2 个不同顶点/);

    expect(buildDrawingGeometry("polygon", [[0, 0], [10, 0], [5, 10]])).toEqual({
      rect: [0, 0, 10, 10],
      points: [[0, 0], [10, 0], [5, 10]],
    });
  });

  it("keeps a visual page point stable through rotated CropBox coordinates", () => {
    const derived = derivePageCoordinateSpace([0, 0, 600, 500], [0, 1, 1, 0, -100, -50]);
    const pagePoint = [140, 220] as const;
    const pdfPoint = pagePointToPdf(pagePoint, derived.space);

    expect(pdfPointToPage(pdfPoint, derived.space)).toEqual(pagePoint);
    expect(buildDrawingGeometry("line", [pdfPoint, [pdfPoint[0] + 20, pdfPoint[1]]])).toEqual({
      rect: [220, 140, 240, 140],
      points: [[220, 140], [240, 140]],
    });
  });
});
