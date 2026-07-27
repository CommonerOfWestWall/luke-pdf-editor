import { describe, expect, it } from "vitest";
import { thumbnailRenderPlan } from "./thumbnail-render";

describe("thumbnailRenderPlan", () => {
  it("fits a portrait page without stretching and caps DPR at two", () => {
    const plan = thumbnailRenderPlan(612, 792, 0, 144, 126, 3);

    expect(plan.width).toBe(97);
    expect(plan.height).toBe(126);
    expect(plan.rasterScale).toBeCloseTo((126 / 792) * 2);
  });

  it("swaps the preview dimensions after a quarter turn", () => {
    const unrotated = thumbnailRenderPlan(612, 792, 0, 144, 126, 1);
    const rotated = thumbnailRenderPlan(612, 792, 90, 144, 126, 1);

    expect(unrotated.height).toBe(126);
    expect(rotated.width).toBe(144);
    expect(rotated.height).toBe(111);
  });

  it("keeps invalid dimensions finite and visible", () => {
    expect(thumbnailRenderPlan(0, Number.NaN, 0, 144, 126, 0)).toEqual({
      width: 126,
      height: 126,
      rasterScale: 126,
    });
  });
});
