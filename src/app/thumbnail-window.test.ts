import { describe, expect, it } from "vitest";
import { getThumbnailWindow } from "./thumbnail-window";

const defaults = {
  pageCount: 1_000,
  viewportHeight: 600,
  columns: 1,
  rowHeight: 164,
  overscanRows: 3,
};

describe("getThumbnailWindow", () => {
  it("keeps the first thumbnail window small for a thousand-page document", () => {
    expect(getThumbnailWindow({ ...defaults, scrollTop: 0 })).toEqual({ start: 0, end: 7 });
  });

  it("moves the bounded window through the middle of a long document", () => {
    const result = getThumbnailWindow({ ...defaults, scrollTop: 27_000 });

    expect(result).toEqual({ start: 161, end: 172 });
    expect(result.end - result.start).toBeLessThanOrEqual(12);
  });

  it("never runs beyond an incomplete final row", () => {
    expect(
      getThumbnailWindow({ ...defaults, pageCount: 11, scrollTop: 10_000 }),
    ).toEqual({ start: 11, end: 11 });
  });
});
