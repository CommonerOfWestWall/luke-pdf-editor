import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { AnnotationRecord } from "../pdf/contracts";
import {
  annotationColorToHex,
  annotationKindLabel,
} from "./annotation-panel";
import { parseLukeLookReview } from "./luke-look-review";
import {
  findVirtualRange,
  scrollTopForVirtualItem,
} from "./virtual-window";

const ESTIMATED_CARD_HEIGHT = 105;
const ESTIMATED_GROUP_HEADER_HEIGHT = 29;
const ROW_GAP = 7;
const OVERSCAN_PX = 360;

interface ReviewRow {
  annotation: AnnotationRecord;
  groupCount: number;
  groupLabel: string;
  showHeader: boolean;
}

export function VirtualReviewList({
  annotations,
  currentPageIndex,
  selectedId,
  cursorId,
  labelForPage,
  onSelect,
  registerCard,
}: {
  annotations: readonly AnnotationRecord[];
  currentPageIndex: number;
  selectedId: string | null;
  cursorId: string | null;
  labelForPage: (pageIndex: number) => string | undefined;
  onSelect: (annotation: AnnotationRecord) => void;
  registerCard: (id: string, element: HTMLButtonElement | null) => void;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const localCardRefs = useRef(new Map<string, HTMLButtonElement>());
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(600);
  const [measurements, setMeasurements] = useState<ReadonlyMap<string, number>>(
    () => new Map(),
  );

  const rows = useMemo<ReviewRow[]>(() => {
    const counts = new Map<number, number>();
    for (const annotation of annotations) {
      counts.set(annotation.pageIndex, (counts.get(annotation.pageIndex) ?? 0) + 1);
    }
    return annotations.map((annotation, index) => ({
      annotation,
      groupCount: counts.get(annotation.pageIndex) ?? 1,
      groupLabel: labelForPage(annotation.pageIndex) ?? String(annotation.pageIndex + 1),
      showHeader: index === 0 || annotations[index - 1].pageIndex !== annotation.pageIndex,
    }));
  }, [annotations, labelForPage]);

  const layout = useMemo(() => {
    const offsets: number[] = [];
    const heights: number[] = [];
    let totalHeight = 0;
    for (const row of rows) {
      offsets.push(totalHeight);
      const estimated = ESTIMATED_CARD_HEIGHT
        + ROW_GAP
        + (row.showHeader ? ESTIMATED_GROUP_HEADER_HEIGHT : 0);
      const height = measurements.get(row.annotation.id) ?? estimated;
      heights.push(height);
      totalHeight += height;
    }
    return { offsets, heights, totalHeight };
  }, [measurements, rows]);

  const range = useMemo(() => findVirtualRange(
    layout.offsets,
    layout.heights,
    scrollTop,
    viewportHeight,
    OVERSCAN_PX,
  ), [layout, scrollTop, viewportHeight]);

  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const updateViewport = () => setViewportHeight(Math.max(1, scroller.clientHeight));
    updateViewport();
    const observer = new ResizeObserver(updateViewport);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const elements = scroller.querySelectorAll<HTMLElement>("[data-review-row]");
    setMeasurements((previous) => {
      let next: Map<string, number> | null = null;
      for (const element of elements) {
        const id = element.dataset.reviewRow;
        if (!id) continue;
        const height = Math.ceil(element.getBoundingClientRect().height);
        if (height <= 0 || previous.get(id) === height) continue;
        next ??= new Map(previous);
        next.set(id, height);
      }
      return next ?? previous;
    });
  }, [range.end, range.start, viewportHeight]);

  useLayoutEffect(() => {
    if (!cursorId) return;
    const scroller = scrollerRef.current;
    const index = rows.findIndex(({ annotation }) => annotation.id === cursorId);
    if (!scroller || index < 0) return;
    const nextScrollTop = scrollTopForVirtualItem(
      layout.offsets,
      layout.heights,
      index,
      scroller.scrollTop,
      scroller.clientHeight,
    );
    if (Math.abs(nextScrollTop - scroller.scrollTop) > 1) {
      scroller.scrollTop = nextScrollTop;
      setScrollTop(nextScrollTop);
    }
  }, [cursorId, layout, rows]);

  useLayoutEffect(() => {
    if (!cursorId || selectedId) return;
    localCardRefs.current.get(cursorId)?.focus({ preventScroll: true });
  }, [cursorId, range.end, range.start, selectedId]);

  return (
    <div
      className="comment-list"
      ref={scrollerRef}
      role="list"
      aria-label="文档审读意见"
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
    >
      <div className="virtual-review-spacer" style={{ height: layout.totalHeight }}>
        {rows.slice(range.start, range.end).map((row, visibleIndex) => {
          const index = range.start + visibleIndex;
          const { annotation } = row;
          const review = parseLukeLookReview(annotation.contents);
          return (
            <section
              className="comment-page-group virtual-review-row"
              data-review-row={annotation.id}
              key={annotation.id}
              role="listitem"
              aria-posinset={index + 1}
              aria-setsize={rows.length}
              style={{ transform: `translateY(${layout.offsets[index]}px)` }}
            >
              {row.showHeader && (
                <header className={annotation.pageIndex === currentPageIndex ? "is-current" : ""}>
                  <span>
                    {row.groupLabel === String(annotation.pageIndex + 1)
                      ? `PDF 第 ${annotation.pageIndex + 1} 页`
                      : `页签 ${row.groupLabel}`}
                  </span>
                  <span>{row.groupCount} 条</span>
                </header>
              )}
              <button
                className={`comment-card${annotation.id === selectedId ? " is-selected" : ""}${annotation.id === cursorId ? " is-cursor" : ""}`}
                ref={(element) => {
                  if (element) localCardRefs.current.set(annotation.id, element);
                  else localCardRefs.current.delete(annotation.id);
                  registerCard(annotation.id, element);
                }}
                type="button"
                aria-pressed={annotation.id === selectedId}
                aria-current={annotation.id === cursorId ? "true" : undefined}
                style={{ borderLeftColor: annotationColorToHex(annotation.style.color) }}
                onClick={() => onSelect(annotation)}
              >
                <header>
                  <div className="review-badges">
                    {review.isLukeLook && <span className="severity-badge">{review.severity}</span>}
                    <span className="category-badge">
                      {review.isLukeLook ? review.category : annotationKindLabel(annotation.kind)}
                    </span>
                  </div>
                  <time>
                    {annotation.modifiedAt
                      ? new Date(annotation.modifiedAt).toLocaleDateString("zh-CN")
                      : ""}
                  </time>
                </header>
                {review.isLukeLook ? (
                  <div className="review-change">
                    <span>{review.problem || "未提供问题片段"}</span>
                    <em>改为</em>
                    <strong>{review.suggestion || "查看详情"}</strong>
                  </div>
                ) : (
                  <p>
                    {annotation.contents
                      || annotation.subject
                      || `（无内容的${annotationKindLabel(annotation.kind)}）`}
                  </p>
                )}
                <footer>
                  <span>PDF 第 {annotation.pageIndex + 1} 页</span>
                  <span>
                    {review.isLukeLook && row.groupLabel !== String(annotation.pageIndex + 1)
                      ? `页签 ${row.groupLabel}`
                      : annotation.author || "未知作者"}
                  </span>
                </footer>
              </button>
            </section>
          );
        })}
      </div>
    </div>
  );
}
