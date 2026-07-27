import { describe, expect, it } from "vitest";
import {
  nextReviewIndex,
  reviewNavigationIntent,
  reviewOffsetForArrowKey,
} from "./review-navigation";

describe("reviewOffsetForArrowKey", () => {
  it("uses up and down whenever the review panel is active", () => {
    expect(reviewOffsetForArrowKey("ArrowDown", true, false)).toBe(1);
    expect(reviewOffsetForArrowKey("ArrowUp", true, false)).toBe(-1);
  });

  it("also uses left and right while review details are open", () => {
    expect(reviewOffsetForArrowKey("ArrowRight", true, true)).toBe(1);
    expect(reviewOffsetForArrowKey("ArrowLeft", true, true)).toBe(-1);
    expect(reviewOffsetForArrowKey("ArrowRight", true, false)).toBeNull();
  });

  it("does not intercept arrows outside review navigation", () => {
    expect(reviewOffsetForArrowKey("ArrowDown", false, true)).toBeNull();
    expect(reviewOffsetForArrowKey("PageDown", true, true)).toBeNull();
  });
});

describe("nextReviewIndex", () => {
  it("enters the list at the nearest end and clamps at boundaries", () => {
    expect(nextReviewIndex(-1, 3, 1)).toBe(0);
    expect(nextReviewIndex(-1, 3, -1)).toBe(2);
    expect(nextReviewIndex(0, 3, -1)).toBe(0);
    expect(nextReviewIndex(2, 3, 1)).toBe(2);
  });
});

describe("reviewNavigationIntent", () => {
  it("keeps up and down in the review list until the user explicitly opens details", () => {
    expect(reviewNavigationIntent("ArrowDown", true, false)).toEqual({ scope: "list", offset: 1 });
    expect(reviewNavigationIntent("ArrowUp", true, false)).toEqual({ scope: "list", offset: -1 });
  });

  it("uses all four arrows only inside an already-open detail view", () => {
    expect(reviewNavigationIntent("ArrowDown", true, true)).toEqual({ scope: "detail", offset: 1 });
    expect(reviewNavigationIntent("ArrowLeft", true, true)).toEqual({ scope: "detail", offset: -1 });
  });

  it("restores up and down page navigation when the review panel is closed", () => {
    expect(reviewNavigationIntent("ArrowDown", false, false)).toEqual({ scope: "page", offset: 1 });
    expect(reviewNavigationIntent("ArrowUp", false, false)).toEqual({ scope: "page", offset: -1 });
  });
});
