import { useEffect, useMemo, useRef, useState } from "react";
import type { AnnotationRecord, DocumentInfo, PageInfo, RenderedPage } from "../pdf/contracts";
import type { PdfClient } from "../pdf/pdf-client";
import { layoutPrintComments, parsePageRange } from "./print-layout";

type RangeMode = "current" | "all" | "custom";

interface PrintRaster {
  pageIndex: number;
  url: string;
}

function rasterUrl(rendered: RenderedPage): string {
  return URL.createObjectURL(new Blob([Uint8Array.from(rendered.png).buffer], { type: "image/png" }));
}

function PrintSheet({
  page,
  raster,
  annotations,
  includeAnnotations,
  printable = false,
}: {
  page: PageInfo;
  raster: PrintRaster;
  annotations: readonly AnnotationRecord[];
  includeAnnotations: boolean;
  printable?: boolean;
}) {
  const gutterWidth = includeAnnotations ? Math.max(190, page.width * 0.34) : 0;
  const totalWidth = page.width + gutterWidth;
  const placements = includeAnnotations ? layoutPrintComments(annotations, page.height) : [];
  return (
    <article
      className={`print-sheet${printable ? " is-printable" : ""}${includeAnnotations ? " has-comments" : ""}`}
      style={{ aspectRatio: `${totalWidth} / ${page.height}` }}
      aria-label={`第 ${page.index + 1} 页打印预览`}
    >
      <img
        src={raster.url}
        alt={`第 ${page.index + 1} 页`}
        style={{ width: `${page.width / totalWidth * 100}%` }}
      />
      {includeAnnotations && (
        <>
          <svg className="print-connectors" viewBox={`0 0 ${totalWidth} ${page.height}`} preserveAspectRatio="none" aria-hidden="true">
            {placements.map(({ annotation, anchorY, top, height }) => {
              const anchorX = Math.min(page.width, Math.max(0, annotation.rect[2]));
              return (
                <polyline
                  key={annotation.id}
                  points={`${anchorX},${anchorY} ${page.width + 10},${anchorY} ${page.width + 22},${top + height / 2}`}
                />
              );
            })}
          </svg>
          <div className="print-comment-gutter" style={{ left: `${page.width / totalWidth * 100}%` }}>
            {placements.map(({ annotation, top, height }) => (
              <section
                className="print-comment-bar"
                key={annotation.id}
                style={{
                  top: `${top / page.height * 100}%`,
                  height: `${height / page.height * 100}%`,
                }}
              >
                <strong>{annotation.subject || "批注"} · {annotation.author || "未知作者"}</strong>
                <p>{annotation.contents}</p>
              </section>
            ))}
          </div>
        </>
      )}
      <span className="print-page-label">第 {page.index + 1} 页</span>
    </article>
  );
}

export function PrintPreviewDialog({
  client,
  documentInfo,
  annotations,
  currentPage,
  renderScope,
  onClose,
}: {
  client: PdfClient;
  documentInfo: DocumentInfo;
  annotations: readonly AnnotationRecord[];
  currentPage: number;
  renderScope: string;
  onClose: () => void;
}) {
  const [rangeMode, setRangeMode] = useState<RangeMode>("current");
  const [customRange, setCustomRange] = useState(String(currentPage + 1));
  const [includeAnnotations, setIncludeAnnotations] = useState(true);
  const [previewPage, setPreviewPage] = useState(currentPage);
  const [previewRaster, setPreviewRaster] = useState<PrintRaster | null>(null);
  const [printRasters, setPrintRasters] = useState<PrintRaster[]>([]);
  const [preparing, setPreparing] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const [readyToPrint, setReadyToPrint] = useState(false);
  const printAbortRef = useRef<AbortController | null>(null);

  const selectedPages = useMemo(() => {
    try {
      if (rangeMode === "current") return [currentPage];
      if (rangeMode === "all") return Array.from({ length: documentInfo.pageCount }, (_, index) => index);
      return parsePageRange(customRange, documentInfo.pageCount);
    } catch {
      return [];
    }
  }, [currentPage, customRange, documentInfo.pageCount, rangeMode]);

  useEffect(() => {
    if (selectedPages.length && !selectedPages.includes(previewPage)) setPreviewPage(selectedPages[0]);
  }, [previewPage, selectedPages]);

  useEffect(() => {
    const controller = new AbortController();
    let url: string | null = null;
    setPreviewRaster(null);
    setError(null);
    void client.renderPage(
      { pageIndex: previewPage, scale: 1.15, rotation: 0, includeAnnotations },
      {
        scope: renderScope,
        key: `print-preview:${previewPage}:${includeAnnotations}`,
        priority: "visible",
        signal: controller.signal,
      },
    ).then((rendered) => {
      url = rasterUrl(rendered);
      setPreviewRaster({ pageIndex: previewPage, url });
    }).catch((reason) => {
      if (!controller.signal.aborted) {
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    });
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [client, includeAnnotations, previewPage, renderScope]);

  useEffect(() => () => {
    printRasters.forEach(({ url }) => URL.revokeObjectURL(url));
  }, [printRasters]);

  useEffect(() => {
    if (!readyToPrint || !printRasters.length) return;
    let cancelled = false;
    const run = async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      const images = Array.from(document.querySelectorAll<HTMLImageElement>(".print-output img"));
      await Promise.all(images.map((image) => image.decode().catch(() => undefined)));
      if (!cancelled) window.print();
    };
    void run();
    return () => { cancelled = true; };
  }, [printRasters, readyToPrint]);

  useEffect(() => {
    const finish = () => {
      setReadyToPrint(false);
      setPrintRasters([]);
    };
    window.addEventListener("afterprint", finish);
    return () => window.removeEventListener("afterprint", finish);
  }, []);

  const prepareAndPrint = async () => {
    if (!selectedPages.length || preparing) return;
    const controller = new AbortController();
    printAbortRef.current = controller;
    setPreparing(true);
    setError(null);
    setReadyToPrint(false);
    setPrintRasters([]);
    setProgress({ current: 0, total: selectedPages.length });
    const next: PrintRaster[] = [];
    try {
      for (let index = 0; index < selectedPages.length; index += 1) {
        const pageIndex = selectedPages[index];
        const rendered = await client.renderPage(
          { pageIndex, scale: 1.5, rotation: 0, includeAnnotations },
          {
            scope: renderScope,
            key: `print-output:${pageIndex}:${includeAnnotations}`,
            priority: "visible",
            signal: controller.signal,
          },
        );
        next.push({ pageIndex, url: rasterUrl(rendered) });
        setProgress({ current: index + 1, total: selectedPages.length });
      }
      setPrintRasters(next);
      setReadyToPrint(true);
    } catch (reason) {
      next.forEach(({ url }) => URL.revokeObjectURL(url));
      if (!controller.signal.aborted) {
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    } finally {
      printAbortRef.current = null;
      setPreparing(false);
    }
  };

  const close = () => {
    printAbortRef.current?.abort();
    onClose();
  };

  const previewAnnotations = annotations.filter(({ pageIndex }) => pageIndex === previewPage);
  const previewInfo = documentInfo.pages[previewPage];

  return (
    <div className="modal-backdrop print-preview-backdrop" role="presentation">
      <section className="print-preview-dialog" role="dialog" aria-modal="true" aria-labelledby="print-preview-title">
        <header className="print-preview-header">
          <div>
            <span>打印前检查版面与批注</span>
            <h2 id="print-preview-title">打印预览</h2>
          </div>
          <button type="button" aria-label="关闭打印预览" onClick={close}>×</button>
        </header>
        <aside className="print-options">
          <fieldset>
            <legend>页面范围</legend>
            <label><input type="radio" name="range" checked={rangeMode === "current"} onChange={() => setRangeMode("current")} />当前页（{currentPage + 1}）</label>
            <label><input type="radio" name="range" checked={rangeMode === "all"} onChange={() => setRangeMode("all")} />全部 {documentInfo.pageCount} 页</label>
            <label><input type="radio" name="range" checked={rangeMode === "custom"} onChange={() => setRangeMode("custom")} />指定页码</label>
            <input
              value={customRange}
              disabled={rangeMode !== "custom"}
              aria-label="指定打印页码"
              placeholder="例如 1-3, 8, 12"
              onChange={(event) => setCustomRange(event.target.value)}
            />
          </fieldset>
          <fieldset>
            <legend>批注</legend>
            <label className="print-annotation-toggle">
              <input type="checkbox" checked={includeAnnotations} onChange={(event) => setIncludeAnnotations(event.target.checked)} />
              <span><strong>打印批注与页外批注条</strong><small>正文保持完整，虚线连接批注位置</small></span>
            </label>
          </fieldset>
          <div className="print-summary">
            <strong>{selectedPages.length || "—"} 页</strong>
            <span>{includeAnnotations ? "包含批注外观与批注条" : "不包含任何 PDF 批注外观"}</span>
          </div>
          {error && <p className="print-error" role="alert">{error}</p>}
          {preparing && <div className="print-progress"><span style={{ width: `${progress.total ? progress.current / progress.total * 100 : 0}%` }} /><small>正在准备 {progress.current} / {progress.total} 页</small></div>}
          <div className="print-actions">
            <button type="button" onClick={close}>{preparing ? "取消准备" : "取消"}</button>
            <button className="primary-button" type="button" disabled={!selectedPages.length || preparing} onClick={() => void prepareAndPrint()}>
              {preparing ? "正在准备…" : "进入系统打印"}
            </button>
          </div>
        </aside>
        <main className="print-preview-stage">
          <div className="print-preview-toolbar">
            <button type="button" disabled={previewPage <= 0} onClick={() => setPreviewPage((page) => page - 1)}>上一页</button>
            <span>第 {previewPage + 1} / {documentInfo.pageCount} 页</span>
            <button type="button" disabled={previewPage >= documentInfo.pageCount - 1} onClick={() => setPreviewPage((page) => page + 1)}>下一页</button>
          </div>
          <div className="print-preview-canvas">
            {previewRaster && previewRaster.pageIndex === previewPage && (
              <PrintSheet page={previewInfo} raster={previewRaster} annotations={previewAnnotations} includeAnnotations={includeAnnotations} />
            )}
            {!previewRaster && <div className="print-preview-loading">正在生成预览…</div>}
          </div>
        </main>
      </section>
      <div className="print-output" aria-hidden={!readyToPrint}>
        {printRasters.map((raster) => {
          const page = documentInfo.pages[raster.pageIndex];
          return (
            <PrintSheet
              printable
              key={raster.pageIndex}
              page={page}
              raster={raster}
              annotations={annotations.filter(({ pageIndex }) => pageIndex === raster.pageIndex)}
              includeAnnotations={includeAnnotations}
            />
          );
        })}
      </div>
    </div>
  );
}
