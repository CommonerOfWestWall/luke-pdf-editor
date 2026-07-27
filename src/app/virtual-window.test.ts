import { describe, expect, it } from "vitest";
import { findVirtualRange, scrollTopForVirtualItem } from "./virtual-window";

const offsets = Array.from({ length: 253 }, (_, index) => index * 120);
const heights = Array.from({ length: 253 }, () => 120);

describe("virtual review window", () => {
  it("keeps a bounded render range for a long review list", () => {
    expect(findVirtualRange(offsets, heights, 12_000, 600, 360)).toEqual({
      start: 96,
      end: 109,
    });
  });

  it("moves the viewport only when the target item is outside it", () => {
    expect(scrollTopForVirtualItem(offsets, heights, 5, 600, 600)).toBe(600);
    expect(scrollTopForVirtualItem(offsets, heights, 20, 600, 600)).toBe(1_920);
    expect(scrollTopForVirtualItem(offsets, heights, 2, 600, 600)).toBe(240);
  });
});
