import type { SearchHit } from "./contracts";

export function mostVisiblePage(
  ratios: ReadonlyMap<number, number>,
  pageCount: number,
  fallback: number,
): number {
  const lastPage = Math.max(0, pageCount - 1);
  let selected = Math.min(Math.max(0, fallback), lastPage);
  let selectedRatio = -1;
  for (const [pageIndex, ratio] of ratios) {
    if (pageIndex < 0 || pageIndex >= pageCount || ratio <= selectedRatio) continue;
    selected = pageIndex;
    selectedRatio = ratio;
  }
  return selected;
}

export function shouldScrollPageIntoView(
  pageIndex: number,
  observedPageIndex: number | null,
  layoutChanged: boolean,
): boolean {
  return layoutChanged || observedPageIndex !== pageIndex;
}

export function firstSearchHitPage(hits: readonly SearchHit[]): number | null {
  return hits[0]?.pageIndex ?? null;
}

export function nextSearchHitIndex(
  hitCount: number,
  currentIndex: number,
  direction: 1 | -1,
): number | null {
  if (hitCount === 0) return null;
  if (currentIndex < 0 || currentIndex >= hitCount) return direction === 1 ? 0 : hitCount - 1;
  return (currentIndex + direction + hitCount) % hitCount;
}
