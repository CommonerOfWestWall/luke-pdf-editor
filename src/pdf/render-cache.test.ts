import { describe, expect, it } from "vitest";
import {
  bufferedPageIndexes,
  ByteLruCache,
  effectiveRasterScale,
  MAX_RASTER_DIMENSION,
  MAX_RASTER_PIXELS_PER_PAGE,
  pageRenderKey,
} from "./render-cache";

describe("bufferedPageIndexes", () => {
  it("adds one page of buffer without crossing document bounds", () => {
    expect([...bufferedPageIndexes(new Set([0, 4]), 5)].sort((a, b) => a - b)).toEqual([0, 1, 3, 4]);
  });
});

describe("ByteLruCache", () => {
  it("evicts the least recently used entry when the byte budget is exceeded", () => {
    const cache = new ByteLruCache<string>(10);
    cache.set("a", "A", 4);
    cache.set("b", "B", 4);
    expect(cache.get("a")).toBe("A");
    cache.set("c", "C", 4);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe("A");
    expect(cache.get("c")).toBe("C");
  });

  it("keeps one oversized entry so the current page remains available", () => {
    const cache = new ByteLruCache<string>(5);
    cache.set("large", "page", 12);
    expect(cache.size).toBe(1);
    expect(cache.get("large")).toBe("page");
  });
});

describe("pageRenderKey", () => {
  it("isolates frames by document, revision, page, scale and rotation", () => {
    const base = pageRenderKey(1, 0, 0, 1, 0);

    expect(pageRenderKey(2, 0, 0, 1, 0)).not.toBe(base);
    expect(pageRenderKey(1, 1, 0, 1, 0)).not.toBe(base);
    expect(pageRenderKey(1, 0, 1, 1, 0)).not.toBe(base);
    expect(pageRenderKey(1, 0, 0, 1.1, 0)).not.toBe(base);
    expect(pageRenderKey(1, 0, 0, 1, 90)).not.toBe(base);
  });

  it("reuses the same capped raster at nearby visual zoom levels", () => {
    const first = effectiveRasterScale(2384, 3370, 1, 2);
    const second = effectiveRasterScale(2384, 3370, 1.1, 2);
    expect(first).toBe(second);
    expect(pageRenderKey(1, 0, 0, first, 0)).toBe(pageRenderKey(1, 0, 0, second, 0));
  });
});

describe("effectiveRasterScale", () => {
  it("keeps ordinary DPR rendering at the requested resolution", () => {
    expect(effectiveRasterScale(612, 792, 1, 2)).toBe(2);
  });

  it("caps an A0 engineering sheet at high zoom and DPR", () => {
    const scale = effectiveRasterScale(2384, 3370, 4, 2);
    expect(2384 * 3370 * scale * scale).toBeLessThanOrEqual(MAX_RASTER_PIXELS_PER_PAGE + 1);
    expect(3370 * scale).toBeLessThanOrEqual(MAX_RASTER_DIMENSION);
    expect(scale).toBeLessThan(8);
  });
});
