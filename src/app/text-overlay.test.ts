import { describe, expect, it } from "vitest";
import { characterQuadStyle, mapQuad, quadClipPath } from "./text-overlay";

describe("quad-driven text overlay", () => {
  it("maps a vertical glyph to an exact rotated CSS box", () => {
    const style = characterQuadStyle([369, 50, 369, 63, 344, 50, 344, 63], 2);
    expect(style).toEqual({
      left: 738,
      top: 100,
      width: 26,
      height: 50,
      transform: "matrix(0, 1, -1, 0, 0, 0)",
    });
  });

  it("keeps a slanted search quad as a polygon", () => {
    expect(quadClipPath([10, 10, 30, 20, 5, 20, 25, 30], 1)).toBe(
      "polygon(10px 10px, 30px 20px, 25px 30px, 5px 20px)",
    );
  });

  it("transforms every quad vertex without collapsing it to a rectangle", () => {
    expect(mapQuad([0, 0, 2, 1, 0, 2, 2, 3], ([x, y]) => [x + 5, y - 4])).toEqual([
      5, -4, 7, -3, 5, -2, 7, -1,
    ]);
  });
});
