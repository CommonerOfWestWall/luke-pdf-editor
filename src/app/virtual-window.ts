export interface VirtualRange {
  start: number;
  end: number;
}

export function findVirtualRange(
  offsets: readonly number[],
  heights: readonly number[],
  scrollTop: number,
  viewportHeight: number,
  overscan: number,
): VirtualRange {
  if (offsets.length === 0) return { start: 0, end: 0 };
  const lowerBound = Math.max(0, scrollTop - overscan);
  const upperBound = scrollTop + Math.max(0, viewportHeight) + overscan;
  let start = 0;
  while (start < offsets.length && offsets[start] + heights[start] < lowerBound) start += 1;
  let end = start;
  while (end < offsets.length && offsets[end] <= upperBound) end += 1;
  return { start, end };
}

export function scrollTopForVirtualItem(
  offsets: readonly number[],
  heights: readonly number[],
  index: number,
  scrollTop: number,
  viewportHeight: number,
): number {
  if (index < 0 || index >= offsets.length) return scrollTop;
  const itemTop = offsets[index];
  const itemBottom = itemTop + heights[index];
  if (itemTop < scrollTop) return itemTop;
  if (itemBottom > scrollTop + viewportHeight) {
    return Math.max(0, itemBottom - viewportHeight);
  }
  return scrollTop;
}
