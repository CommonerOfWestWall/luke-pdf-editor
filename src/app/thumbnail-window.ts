export interface ThumbnailWindowOptions {
  pageCount: number;
  scrollTop: number;
  viewportHeight: number;
  columns: number;
  rowHeight: number;
  overscanRows: number;
}

export function getThumbnailWindow({
  pageCount,
  scrollTop,
  viewportHeight,
  columns,
  rowHeight,
  overscanRows,
}: ThumbnailWindowOptions): { start: number; end: number } {
  const rowCount = Math.ceil(pageCount / columns);
  const startRow = Math.max(0, Math.floor(scrollTop / rowHeight) - overscanRows);
  const endRow = Math.min(
    rowCount,
    Math.ceil((scrollTop + viewportHeight) / rowHeight) + overscanRows,
  );

  return {
    start: Math.min(pageCount, startRow * columns),
    end: Math.min(pageCount, endRow * columns),
  };
}
