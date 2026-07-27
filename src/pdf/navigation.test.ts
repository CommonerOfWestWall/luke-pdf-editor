import { describe, expect, it } from "vitest";
import type { SearchHit } from "./contracts";
import { firstSearchHitPage, mostVisiblePage, nextSearchHitIndex, shouldScrollPageIntoView } from "./navigation";

describe("mostVisiblePage", () => {
  it("chooses the page with the greatest intersection ratio", () => {
    expect(mostVisiblePage(new Map([[4, 0.2], [5, 0.8], [6, 0.4]]), 10, 4)).toBe(5);
  });

  it("ignores stale page indexes from another document", () => {
    expect(mostVisiblePage(new Map([[500, 1], [0, 0.6]]), 2, 0)).toBe(0);
  });
});

describe("programmatic page positioning", () => {
  it("repositions the active page when rotation or scale changes the layout", () => {
    expect(shouldScrollPageIntoView(119, 119, true)).toBe(true);
    expect(shouldScrollPageIntoView(119, 119, false)).toBe(false);
    expect(shouldScrollPageIntoView(119, null, false)).toBe(true);
  });
});

describe("search hit navigation", () => {
  const hits: SearchHit[] = [
    { pageIndex: 3, quads: [] },
    { pageIndex: 8, quads: [] },
  ];

  it("locates the first result page", () => {
    expect(firstSearchHitPage(hits)).toBe(3);
    expect(firstSearchHitPage([])).toBeNull();
  });

  it("cycles forward and backward through results", () => {
    expect(nextSearchHitIndex(hits.length, 1, 1)).toBe(0);
    expect(nextSearchHitIndex(hits.length, 0, -1)).toBe(1);
    expect(nextSearchHitIndex(hits.length, -1, -1)).toBe(1);
    expect(nextSearchHitIndex(0, 0, 1)).toBeNull();
  });
});
