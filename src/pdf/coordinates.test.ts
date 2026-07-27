import { describe, expect, it } from "vitest";
import { derivePageCoordinateSpace, pagePointToPdf, pageRectToPdf, pdfPointToPage, pdfPointToViewport, pdfRectToPage, pdfRectToViewport, viewportPointToPage, viewportPointToPdf } from "./coordinates";

describe("PDF coordinate transforms", () => {
  const base = { width: 600, height: 800, scale: 2 } as const;

  for (const rotation of [0, 90, 180, 270] as const) {
    it(`round-trips a point at ${rotation} degrees`, () => {
      const transform = { ...base, rotation };
      const viewport = pdfPointToViewport([123, 456], transform);
      expect(viewportPointToPdf(viewport, transform)).toEqual([123, 456]);
    });
  }

  it("normalizes a rotated rectangle", () => {
    expect(pdfRectToViewport([10, 20, 110, 70], { ...base, rotation: 90 })).toEqual([
      40, 20, 140, 220,
    ]);
  });

  it("handles an intrinsic 90 degree rotation and non-zero PDF box origin", () => {
    const derived = derivePageCoordinateSpace([0, 0, 600, 500], [0, 1, 1, 0, -100, -50]);

    expect(derived.width).toBe(500);
    expect(derived.height).toBe(600);
    expect(derived.space.pdfOrigin).toEqual([50, 100]);
    expect(pagePointToPdf([0, 0], derived.space)).toEqual([0, 0]);
    expect(pdfPointToPage([500, 600], derived.space)).toEqual([600, 500]);
    expect(pageRectToPdf([0, 0, 100, 50], derived.space)).toEqual([0, 0, 50, 100]);
    expect(pdfRectToPage([0, 0, 50, 100], derived.space)).toEqual([0, 0, 100, 50]);
  });

  it("reverses the user rotation into top-left page coordinates", () => {
    expect(viewportPointToPage([200, 100], { width: 600, height: 800, scale: 2, rotation: 0 })).toEqual([100, 50]);
    expect(viewportPointToPage([200, 100], { width: 600, height: 800, scale: 2, rotation: 90 })).toEqual([50, 700]);
    expect(viewportPointToPage([200, 100], { width: 600, height: 800, scale: 2, rotation: 180 })).toEqual([500, 750]);
    expect(viewportPointToPage([200, 100], { width: 600, height: 800, scale: 2, rotation: 270 })).toEqual([550, 100]);
  });
});
