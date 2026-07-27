import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ExtractedText, PageInfo, PdfLink, PdfQuad, RenderedPage, SearchHit } from "../pdf/contracts";
import type { PdfClient } from "../pdf/pdf-client";
import { mostVisiblePage, shouldScrollPageIntoView } from "../pdf/navigation";
import { bufferedPageIndexes, ByteLruCache, effectiveRasterScale, pageRenderKey } from "../pdf/render-cache";
import { isRenderAbortError, type RenderPriority } from "../pdf/render-scheduler";
import { pagePointToPdf, pdfPointToPage, pdfRectToPage, viewportPointToPage } from "../pdf/coordinates";
import { quadsForMarkupSelection, rectForQuads, type MarkupCharacter } from "../pdf/text-markup";
import { characterQuadStyle, mapQuad, quadClipPath } from "./text-overlay";

const renderCache = new ByteLruCache<RenderedPage>(96 * 1024 * 1024);

export type TextMarkupTool = "highlight" | "underline" | "strikeout" | "squiggly";

export interface TextMarkupSelection {
  kind: TextMarkupTool;
  pageIndex: number;
  quadPoints: readonly PdfQuad[];
  rect: readonly [number, number, number, number];
  text: string;
}

export interface TextMarkupRequest {
  id: number;
  tool: TextMarkupTool;
}

export interface PlacedAnnotationPoint {
  pageIndex: number;
  point: readonly [number, number];
}

function pageDimensions(page: PageInfo, scale: number, rotation: 0 | 90 | 180 | 270) {
  const rotated = rotation === 90 || rotation === 270;
  return {
    width: Math.round((rotated ? page.displayHeight : page.displayWidth) * scale),
    height: Math.round((rotated ? page.displayWidth : page.displayHeight) * scale),
  };
}

function overlayTransform(page: PageInfo, scale: number, rotation: 0 | 90 | 180 | 270): string {
  const width = page.displayWidth * scale;
  const height = page.displayHeight * scale;
  switch (rotation) {
    case 0: return "none";
    case 90: return `translate(${height}px, 0) rotate(90deg)`;
    case 180: return `translate(${width}px, ${height}px) rotate(180deg)`;
    case 270: return `translate(0, ${width}px) rotate(270deg)`;
  }
}

function structuredSelectionText(root: HTMLElement, selection: Selection): string {
  if (selection.rangeCount === 0 || selection.isCollapsed) return "";
  const range = selection.getRangeAt(0);
  return Array.from(root.querySelectorAll<HTMLElement>(".text-layer"))
    .map((layer) => Array.from(layer.querySelectorAll<HTMLElement>(".text-run-line"))
      .map((line) => Array.from(line.querySelectorAll<HTMLElement>(".text-character"))
        .filter((character) => range.intersectsNode(character))
        .map((character) => character.dataset.character ?? "")
        .join(""))
      .filter(Boolean)
      .join("\n"))
    .filter(Boolean)
    .join("\n\f\n");
}

function PageSurface({
  client,
  page,
  scale,
  rotation,
  renderScope,
  cacheKey,
  rasterScale,
  renderPriority,
  copyAllowed,
  searchHits,
  activeSearchHit,
  onNavigatePage,
  onOpenExternal,
  active,
  onError,
  markupTool,
  markupRequest,
  onCreateMarkup,
  placementTool,
  onPlaceAnnotation,
}: {
  client: PdfClient;
  page: PageInfo;
  scale: number;
  rotation: 0 | 90 | 180 | 270;
  renderScope: string;
  cacheKey: string;
  rasterScale: number;
  renderPriority: RenderPriority;
  copyAllowed: boolean;
  searchHits: readonly { index: number; hit: SearchHit }[];
  activeSearchHit: number;
  onNavigatePage: (pageIndex: number) => void;
  onOpenExternal: (url: string) => void;
  active: boolean;
  onError: (error: Error) => void;
  markupTool: TextMarkupTool | null;
  markupRequest: TextMarkupRequest | null;
  onCreateMarkup: (selection: TextMarkupSelection) => void;
  placementTool: "note" | "freeText" | null;
  onPlaceAnnotation: (placement: PlacedAnnotationPoint) => void;
}) {
  const [rendered, setRendered] = useState<{ key: string; value: RenderedPage } | null>(() => {
    const value = renderCache.get(cacheKey);
    return value ? { key: cacheKey, value } : null;
  });
  const [image, setImage] = useState<{ key: string; url: string } | null>(null);
  const [textPage, setTextPage] = useState<ExtractedText | null>(null);
  const [links, setLinks] = useState<PdfLink[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);
  const processedMarkupRequestRef = useRef<number | null>(null);
  const dimensions = pageDimensions(page, scale, rotation);
  const currentRendered = rendered?.key === cacheKey ? rendered.value : null;
  const imageUrl = currentRendered && image?.key === cacheKey ? image.url : null;

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const cached = renderCache.get(cacheKey);
    if (cached) {
      setRendered({ key: cacheKey, value: cached });
      return () => {
        cancelled = true;
        controller.abort();
      };
    }
    setRendered(null);
    void client.renderPage(
      { pageIndex: page.index, scale: rasterScale, rotation },
      { scope: renderScope, key: cacheKey, priority: renderPriority, signal: controller.signal },
    ).then((result) => {
      if (cancelled) return;
      renderCache.set(cacheKey, result, result.png.byteLength);
      setRendered({ key: cacheKey, value: result });
    }).catch((error) => {
      if (!cancelled && !isRenderAbortError(error)) {
        onError(error instanceof Error ? error : new Error(String(error)));
      }
    });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [cacheKey, client, onError, page.index, rasterScale, renderPriority, renderScope, rotation]);

  useEffect(() => {
    if (!currentRendered) return;
    const next = URL.createObjectURL(new Blob([Uint8Array.from(currentRendered.png).buffer], { type: "image/png" }));
    setImage({ key: cacheKey, url: next });
    return () => URL.revokeObjectURL(next);
  }, [cacheKey, currentRendered]);

  useEffect(() => {
    if (!copyAllowed) {
      setTextPage(null);
      return;
    }
    let cancelled = false;
    void client.extractText(page.index).then((result) => {
      if (!cancelled) setTextPage(result);
    }).catch((error) => {
      if (!cancelled) onError(error instanceof Error ? error : new Error(String(error)));
    });
    return () => { cancelled = true; };
  }, [client, copyAllowed, onError, page.index]);

  useEffect(() => {
    let cancelled = false;
    void client.listLinks(page.index).then((result) => {
      if (!cancelled) setLinks(result);
    }).catch((error) => {
      if (!cancelled) onError(error instanceof Error ? error : new Error(String(error)));
    });
    return () => { cancelled = true; };
  }, [client, onError, page.index]);

  const overlayStyle = {
    width: page.displayWidth * scale,
    height: page.displayHeight * scale,
    transform: overlayTransform(page, scale, rotation),
  };

  const captureMarkupSelection = (tool: TextMarkupTool | null = markupTool) => {
    if (!tool || !textPage) return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    if (!rootRef.current?.contains(range.commonAncestorContainer)) return;
    const layer = rootRef.current?.querySelector<HTMLElement>(".text-layer");
    if (!layer) return;
    const characters: MarkupCharacter[] = [];
    layer.querySelectorAll<HTMLElement>(".text-character").forEach((element) => {
      if (!range.intersectsNode(element)) return;
      const line = Number(element.dataset.lineIndex);
      const index = Number(element.dataset.charIndex);
      const character = textPage.lines[line]?.characters[index];
      if (!character) return;
      characters.push({ line, index, text: character.text, quad: character.quad });
    });
    if (!characters.length) return;
    const pageQuads = quadsForMarkupSelection(characters);
    const quadPoints = pageQuads.map((quad) => mapQuad(quad, (point) => pagePointToPdf(point, page.coordinateSpace)));
    onCreateMarkup({
      kind: tool,
      pageIndex: page.index,
      quadPoints,
      rect: rectForQuads(quadPoints),
      text: selection.toString(),
    });
    selection.removeAllRanges();
  };

  useEffect(() => {
    if (!markupRequest || processedMarkupRequestRef.current === markupRequest.id) return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    if (!rootRef.current?.contains(range.commonAncestorContainer)) return;
    processedMarkupRequestRef.current = markupRequest.id;
    captureMarkupSelection(markupRequest.tool);
  }, [markupRequest, textPage]);

  const placeAnnotation = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!placementTool) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const pagePoint = viewportPointToPage(
      [event.clientX - bounds.left, event.clientY - bounds.top],
      {
        width: page.displayWidth,
        height: page.displayHeight,
        scale,
        rotation,
      },
    );
    const pdfPoint = pagePointToPdf(pagePoint, page.coordinateSpace);
    onPlaceAnnotation({
      pageIndex: page.index,
      point: [
        Math.min(page.width, Math.max(0, pdfPoint[0])),
        Math.min(page.height, Math.max(0, pdfPoint[1])),
      ],
    });
  };

  return (
    <div
      className={`page-shadow${active ? " is-active" : ""}`}
      style={{ width: dimensions.width, height: dimensions.height }}
      aria-label={`第 ${page.index + 1} 页`}
      data-markup-tool={markupTool ?? undefined}
      ref={rootRef}
      onMouseUp={markupTool ? () => captureMarkupSelection() : undefined}
      onClick={placementTool ? placeAnnotation : undefined}
    >
      {imageUrl && <img src={imageUrl} width={dimensions.width} height={dimensions.height} alt="" draggable={false} />}
      {!imageUrl && <div className="page-loading"><span /></div>}
      <div className="page-overlay-transform" style={overlayStyle}>
        {textPage && (
          <div className="text-layer" aria-label={`第 ${page.index + 1} 页文本`}>
            {textPage.lines.map((line, lineIndex) => (
              <span className="text-run-line" key={lineIndex}>
                {line.characters.map((character, characterIndex) => {
                  const placement = characterQuadStyle(character.quad, scale);
                  if (!placement) return null;
                  return (
                    <span
                      className="text-character"
                      key={characterIndex}
                      data-character={character.text}
                      data-line-index={lineIndex}
                      data-char-index={characterIndex}
                      style={{
                        ...placement,
                        fontFamily: character.font.family ?? "sans-serif",
                        fontSize: character.font.size * scale,
                        fontWeight: character.font.weight,
                        fontStyle: character.font.style,
                        lineHeight: `${placement.height}px`,
                      }}
                    >{character.text}</span>
                  );
                })}
              </span>
            ))}
          </div>
        )}
        <div className="search-highlight-layer" aria-hidden="true">
          {searchHits.flatMap(({ index, hit }) => hit.quads.map((quad, quadIndex) => {
            const displayQuad = mapQuad(
              quad,
              (point) => pdfPointToPage(point, page.coordinateSpace),
            );
            return (
              <span
                key={`${index}:${quadIndex}`}
                className={index === activeSearchHit ? "is-active" : ""}
                style={{
                  left: 0,
                  top: 0,
                  width: page.displayWidth * scale,
                  height: page.displayHeight * scale,
                  clipPath: quadClipPath(displayQuad, scale),
                }}
              />
            );
          }))}
        </div>
        <div className="link-layer">
          {links.filter((link) => link.external || link.targetPage !== undefined).map((link, index) => {
            const rect = pdfRectToPage(link.bounds, page.coordinateSpace);
            return (
              <button
                key={`${link.uri}:${index}`}
                type="button"
                aria-label={link.external ? `打开外部链接：${link.uri}` : `跳转到第 ${(link.targetPage ?? 0) + 1} 页`}
                title={link.external ? link.uri : `跳转到第 ${(link.targetPage ?? 0) + 1} 页`}
                style={{
                  left: rect[0] * scale,
                  top: rect[1] * scale,
                  width: (rect[2] - rect[0]) * scale,
                  height: (rect[3] - rect[1]) * scale,
                }}
                onClick={(event) => {
                  event.stopPropagation();
                  if (link.external) onOpenExternal(link.uri);
                  else if (link.targetPage !== undefined) onNavigatePage(link.targetPage);
                }}
              />
            );
          })}
        </div>
      </div>
      <span className="page-number-badge">{page.index + 1}</span>
    </div>
  );
}

export function DocumentViewport({
  client,
  pages,
  pageIndex,
  scale,
  rotation,
  documentEpoch,
  renderRevision,
  copyAllowed,
  searchHits,
  activeSearchHit,
  onOpenExternal,
  onPageChange,
  onError,
  markupTool = null,
  markupRequest = null,
  onCreateMarkup,
  placementTool = null,
  onPlaceAnnotation,
  onViewportSizeChange,
}: {
  client: PdfClient;
  pages: PageInfo[];
  pageIndex: number;
  scale: number;
  rotation: 0 | 90 | 180 | 270;
  documentEpoch: number;
  renderRevision: number;
  copyAllowed: boolean;
  searchHits: readonly SearchHit[];
  activeSearchHit: number;
  onOpenExternal: (url: string) => void;
  onPageChange: (pageIndex: number) => void;
  onError: (error: Error) => void;
  markupTool?: TextMarkupTool | null;
  markupRequest?: TextMarkupRequest | null;
  onCreateMarkup?: (selection: TextMarkupSelection) => void;
  placementTool?: "note" | "freeText" | null;
  onPlaceAnnotation?: (placement: PlacedAnnotationPoint) => void;
  onViewportSizeChange?: (size: { width: number; height: number }) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const pageIndexRef = useRef(pageIndex);
  const ratiosRef = useRef(new Map<number, number>());
  const observedPageRef = useRef<number | null>(null);
  const layoutRef = useRef({ rotation, scale });
  const [outputScale, setOutputScale] = useState(() => window.devicePixelRatio || 1);
  const [visiblePages, setVisiblePages] = useState<Set<number>>(() => new Set([pageIndex]));
  const renderScope = `${documentEpoch}:${renderRevision}`;
  const renderPages = useMemo(
    () => bufferedPageIndexes(visiblePages.size ? visiblePages : new Set([pageIndex]), pages.length, 1),
    [pageIndex, pages.length, visiblePages],
  );
  const searchHitsByPage = useMemo(() => {
    const byPage = new Map<number, { index: number; hit: SearchHit }[]>();
    searchHits.forEach((hit, index) => {
      const pageHits = byPage.get(hit.pageIndex) ?? [];
      pageHits.push({ index, hit });
      byPage.set(hit.pageIndex, pageHits);
    });
    return byPage;
  }, [searchHits]);

  useEffect(() => {
    const updateOutputScale = () => setOutputScale(window.devicePixelRatio || 1);
    window.addEventListener("resize", updateOutputScale);
    return () => window.removeEventListener("resize", updateOutputScale);
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || !onViewportSizeChange) return;
    const report = () => onViewportSizeChange({ width: root.clientWidth, height: root.clientHeight });
    report();
    const observer = new ResizeObserver(() => report());
    observer.observe(root);
    return () => observer.disconnect();
  }, [onViewportSizeChange]);

  useEffect(() => {
    const copySelection = (event: ClipboardEvent) => {
      const root = rootRef.current;
      const selection = window.getSelection();
      if (!root || !selection || !event.clipboardData) return;
      const text = structuredSelectionText(root, selection);
      if (!text) return;
      event.preventDefault();
      event.clipboardData.setData("text/plain", text);
    };
    document.addEventListener("copy", copySelection);
    return () => document.removeEventListener("copy", copySelection);
  }, []);

  useEffect(() => {
    pageIndexRef.current = pageIndex;
  }, [pageIndex]);

  useEffect(() => {
    renderCache.clear();
  }, [documentEpoch, renderRevision]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const index = Number((entry.target as HTMLElement).dataset.pageIndex);
        if (entry.isIntersecting) ratiosRef.current.set(index, entry.intersectionRatio);
        else ratiosRef.current.delete(index);
      }
      const visible = new Set(ratiosRef.current.keys());
      if (visible.size) setVisiblePages(visible);
      const activeIndex = mostVisiblePage(ratiosRef.current, pages.length, pageIndexRef.current);
      if (ratiosRef.current.size > 0 && activeIndex !== pageIndexRef.current) {
        observedPageRef.current = activeIndex;
        onPageChange(activeIndex);
      }
    }, { root, rootMargin: "180px 0px", threshold: [0, 0.25, 0.5, 0.75] });
    root.querySelectorAll<HTMLElement>("[data-page-index]").forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [onPageChange, pages.length]);

  useLayoutEffect(() => {
    const layoutChanged = layoutRef.current.rotation !== rotation || layoutRef.current.scale !== scale;
    layoutRef.current = { rotation, scale };
    if (!shouldScrollPageIntoView(pageIndex, observedPageRef.current, layoutChanged)) {
      observedPageRef.current = null;
      return;
    }
    observedPageRef.current = null;
    rootRef.current?.querySelector<HTMLElement>(`[data-page-index="${pageIndex}"]`)?.scrollIntoView({ block: "start" });
  }, [pageIndex, rotation, scale]);

  return (
    <div className="document-scroll" ref={rootRef}>
      <div className="page-stack">
        {pages.map((page) => {
          const dimensions = pageDimensions(page, scale, rotation);
          const shouldRender = renderPages.has(page.index);
          const intrinsicRotated = rotation === 90 || rotation === 270;
          const rasterScale = effectiveRasterScale(
            intrinsicRotated ? page.displayHeight : page.displayWidth,
            intrinsicRotated ? page.displayWidth : page.displayHeight,
            scale,
            outputScale,
          );
          const cacheKey = pageRenderKey(documentEpoch, renderRevision, page.index, rasterScale, rotation);
          const pageSearchHits = searchHitsByPage.get(page.index) ?? [];
          return (
            <section
              className="page-slot"
              data-page-index={page.index}
              key={page.index}
              style={{ width: dimensions.width, minHeight: dimensions.height }}
              aria-current={page.index === pageIndex ? "page" : undefined}
            >
              {shouldRender && (
                <PageSurface
                  key={`${documentEpoch}:${page.index}`}
                  client={client}
                  page={page}
                  scale={scale}
                  rotation={rotation}
                  renderScope={renderScope}
                  cacheKey={cacheKey}
                  rasterScale={rasterScale}
                  renderPriority={page.index === pageIndex ? "visible" : "buffer"}
                  copyAllowed={copyAllowed}
                  searchHits={pageSearchHits}
                  activeSearchHit={activeSearchHit}
                  onNavigatePage={onPageChange}
                  onOpenExternal={onOpenExternal}
                  active={page.index === pageIndex}
                  onError={onError}
                  markupTool={markupTool}
                  markupRequest={markupRequest}
                  onCreateMarkup={onCreateMarkup ?? (() => undefined)}
                  placementTool={placementTool}
                  onPlaceAnnotation={onPlaceAnnotation ?? (() => undefined)}
                />
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
