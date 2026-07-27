export type ReviewNavigationOffset = -1 | 1;
export type ReviewNavigationScope = "list" | "detail" | "page";

export interface ReviewNavigationIntent {
  scope: ReviewNavigationScope;
  offset: ReviewNavigationOffset;
}

export function reviewNavigationIntent(
  key: string,
  reviewPanelOpen: boolean,
  detailOpen: boolean,
): ReviewNavigationIntent | null {
  const offset = key === "ArrowDown" || key === "ArrowRight"
    ? 1
    : key === "ArrowUp" || key === "ArrowLeft"
      ? -1
      : null;
  if (offset === null) return null;
  if (detailOpen && reviewPanelOpen) return { scope: "detail", offset };
  if (key === "ArrowLeft" || key === "ArrowRight") return null;
  return { scope: reviewPanelOpen ? "list" : "page", offset };
}

export function reviewOffsetForArrowKey(
  key: string,
  reviewPanelActive: boolean,
  detailOpen: boolean,
): ReviewNavigationOffset | null {
  if (!reviewPanelActive) return null;
  if (key === "ArrowDown") return 1;
  if (key === "ArrowUp") return -1;
  if (detailOpen && key === "ArrowRight") return 1;
  if (detailOpen && key === "ArrowLeft") return -1;
  return null;
}

export function nextReviewIndex(
  currentIndex: number,
  reviewCount: number,
  offset: ReviewNavigationOffset,
): number {
  if (reviewCount <= 0) return -1;
  if (currentIndex < 0) return offset > 0 ? 0 : reviewCount - 1;
  return Math.min(reviewCount - 1, Math.max(0, currentIndex + offset));
}
