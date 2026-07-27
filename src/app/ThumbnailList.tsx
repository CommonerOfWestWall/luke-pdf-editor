import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PageInfo, RenderedPage } from "../pdf/contracts";
import type { PdfClient } from "../pdf/pdf-client";
import { ByteLruCache, pageRenderKey } from "../pdf/render-cache";
import { isRenderAbortError } from "../pdf/render-scheduler";
import { thumbnailRenderPlan } from "./thumbnail-render";
import { getThumbnailWindow } from "./thumbnail-window";

const COLUMNS = 1;
const ROW_HEIGHT = 164;
const OVERSCAN_ROWS = 3;
const MAX_PREVIEW_WIDTH = 144;
const MAX_PREVIEW_HEIGHT = 126;
const THUMBNAIL_CACHE_BYTES = 24 * 1024 * 1024;

function ThumbnailPreview({
  client,
  cache,
  page,
  priority,
  documentEpoch,
  renderRevision,
  rotation,
  outputScale,
  previewIdentity,
  onFailureChange,
}: {
  client: PdfClient;
  cache: ByteLruCache<RenderedPage>;
  page: PageInfo;
  priority: number;
  documentEpoch: number;
  renderRevision: number;
  rotation: 0 | 90 | 180 | 270;
  outputScale: number;
  previewIdentity: string;
  onFailureChange: (identity: string, failed: boolean) => void;
}) {
  const plan = useMemo(() => thumbnailRenderPlan(
    page.displayWidth,
    page.displayHeight,
    rotation,
    MAX_PREVIEW_WIDTH,
    MAX_PREVIEW_HEIGHT,
    outputScale,
  ), [outputScale, page.displayHeight, page.displayWidth, rotation]);
  const cacheKey = `thumbnail:${pageRenderKey(documentEpoch, renderRevision, page.index, plan.rasterScale, rotation)}`;
  const renderScope = `${documentEpoch}:${renderRevision}`;
  const [rendered, setRendered] = useState<{ key: string; value: RenderedPage } | null>(() => {
    const value = cache.get(cacheKey);
    return value ? { key: cacheKey, value } : null;
  });
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const [image, setImage] = useState<{ key: string; url: string } | null>(null);
  const currentRendered = rendered?.key === cacheKey ? rendered.value : null;
  const failed = failedKey === cacheKey;
  const imageUrl = currentRendered && image?.key === cacheKey ? image.url : null;

  useEffect(() => {
    onFailureChange(previewIdentity, failed);
    return () => onFailureChange(previewIdentity, false);
  }, [failed, onFailureChange, previewIdentity]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const cached = cache.get(cacheKey);
    if (cached) {
      setRendered({ key: cacheKey, value: cached });
      setFailedKey(null);
      return () => {
        cancelled = true;
        controller.abort();
      };
    }

    setRendered(null);
    setFailedKey(null);
    const delay = 80 + Math.min(priority, 10) * 24;
    const timer = window.setTimeout(() => {
      void client.renderPage(
        { pageIndex: page.index, scale: plan.rasterScale, rotation },
        { scope: renderScope, key: cacheKey, priority: "thumbnail", signal: controller.signal },
      ).then((result) => {
        if (cancelled) return;
        cache.set(cacheKey, result, result.png.byteLength);
        setRendered({ key: cacheKey, value: result });
      }).catch((error: unknown) => {
        if (!cancelled && !isRenderAbortError(error)) setFailedKey(cacheKey);
      });
    }, delay);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [cache, cacheKey, client, page.index, plan.rasterScale, priority, renderScope, rotation]);

  useEffect(() => {
    if (!currentRendered) return;
    const next = URL.createObjectURL(new Blob([Uint8Array.from(currentRendered.png).buffer], { type: "image/png" }));
    setImage({ key: cacheKey, url: next });
    return () => URL.revokeObjectURL(next);
  }, [cacheKey, currentRendered]);

  return (
    <span className={`thumbnail-paper${failed ? " is-failed" : ""}`} style={{ width: plan.width, height: plan.height }}>
      {imageUrl && <img src={imageUrl} width={plan.width} height={plan.height} alt="" draggable={false} />}
      {!imageUrl && !failed && <span className="thumbnail-skeleton" aria-hidden="true" />}
      {failed && <span className="thumbnail-failed" role="status" aria-label={`第 ${page.label} 页预览失败`}>预览失败</span>}
    </span>
  );
}

export function ThumbnailList({
  client,
  pages,
  activePage,
  documentEpoch,
  renderRevision,
  rotation,
  onPageChange,
}: {
  client: PdfClient;
  pages: PageInfo[];
  activePage: number;
  documentEpoch: number;
  renderRevision: number;
  rotation: 0 | 90 | 180 | 270;
  onPageChange: (pageIndex: number) => void;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const thumbnailCache = useMemo(
    () => new ByteLruCache<RenderedPage>(THUMBNAIL_CACHE_BYTES),
    [documentEpoch],
  );
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(600);
  const [outputScale, setOutputScale] = useState(() => window.devicePixelRatio || 1);
  const [failedPreviews, setFailedPreviews] = useState<Set<string>>(() => new Set());
  const rowCount = Math.ceil(pages.length / COLUMNS);
  const windowRange = useMemo(
    () =>
      getThumbnailWindow({
        pageCount: pages.length,
        scrollTop,
        viewportHeight,
        columns: COLUMNS,
        rowHeight: ROW_HEIGHT,
        overscanRows: OVERSCAN_ROWS,
      }),
    [pages.length, scrollTop, viewportHeight],
  );
  const visiblePages = pages.slice(windowRange.start, windowRange.end);
  const handleFailureChange = useCallback((identity: string, failed: boolean) => {
    setFailedPreviews((current) => {
      if (current.has(identity) === failed) return current;
      const next = new Set(current);
      if (failed) next.add(identity);
      else next.delete(identity);
      return next;
    });
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const observer = new ResizeObserver(([entry]) => setViewportHeight(entry.contentRect.height));
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const updateOutputScale = () => setOutputScale(window.devicePixelRatio || 1);
    window.addEventListener("resize", updateOutputScale);
    return () => window.removeEventListener("resize", updateOutputScale);
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const row = Math.floor(activePage / COLUMNS);
    const top = row * ROW_HEIGHT;
    const bottom = top + ROW_HEIGHT;
    if (top < viewport.scrollTop) viewport.scrollTo({ top });
    else if (bottom > viewport.scrollTop + viewport.clientHeight) {
      viewport.scrollTo({ top: bottom - viewport.clientHeight });
    }
  }, [activePage, pages]);

  return (
    <div className="thumbnail-list" ref={viewportRef} onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}>
      <div className="thumbnail-track" style={{ height: rowCount * ROW_HEIGHT }}>
        {visiblePages.map((page, visibleIndex) => {
          const row = Math.floor(page.index / COLUMNS);
          const previewIdentity = `${documentEpoch}:${renderRevision}:${rotation}:${page.index}`;
          return (
            <button
              key={page.index}
              type="button"
              className={`thumbnail${page.index === activePage ? " is-active" : ""}`}
              style={{ top: row * ROW_HEIGHT }}
              onClick={() => onPageChange(page.index)}
              aria-label={`第 ${page.label} 页${failedPreviews.has(previewIdentity) ? "，预览失败" : ""}`}
              aria-current={page.index === activePage ? "page" : undefined}
            >
              <ThumbnailPreview
                client={client}
                cache={thumbnailCache}
                page={page}
                priority={page.index === activePage ? 0 : visibleIndex + 1}
                documentEpoch={documentEpoch}
                renderRevision={renderRevision}
                rotation={rotation}
                outputScale={outputScale}
                previewIdentity={previewIdentity}
                onFailureChange={handleFailureChange}
              />
              <span className="thumbnail-label">第 {page.label} 页</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
