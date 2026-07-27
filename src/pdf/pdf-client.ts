import type {
  AnnotationCommand,
  AnnotationRecord,
  DocumentInfo,
  EditState,
  ExtractedText,
  ExportedPdf,
  PdfWorkerReady,
  PdfWorkerMethod,
  PdfLink,
  PdfWorkerRequest,
  PdfWorkerResponse,
  RenderPageRequest,
  RenderedPage,
  SearchHit,
} from "./contracts";
import { RenderScheduler, type RenderPriority, type RenderSchedulerStats } from "./render-scheduler";

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
};

export interface RenderPageOptions {
  scope: string;
  key: string;
  priority: RenderPriority;
  signal?: AbortSignal;
}

export class PdfClient {
  private readonly worker = new Worker(new URL("./pdf.worker.ts", import.meta.url), { type: "module" });
  private readonly pending = new Map<number, PendingRequest>();
  private readonly renderScheduler = new RenderScheduler<RenderedPage>();
  private readonly readyPromise: Promise<void>;
  private resolveReady!: () => void;
  private rejectReady!: (reason: Error) => void;
  private nextId = 1;

  constructor() {
    this.readyPromise = new Promise<void>((resolve, reject) => {
      const timeoutId = globalThis.setTimeout(
        () => reject(new Error("PDF Worker 初始化超时")),
        30_000,
      );
      this.resolveReady = () => {
        globalThis.clearTimeout(timeoutId);
        resolve();
      };
      this.rejectReady = (reason) => {
        globalThis.clearTimeout(timeoutId);
        reject(reason);
      };
    });
    // A standby Worker can be retired before anyone awaits it (for example
    // during React Strict Mode's development cleanup). Keep that intentional
    // rejection from becoming an unhandled promise while preserving it for open().
    void this.readyPromise.catch(() => undefined);
    this.worker.onmessage = (event: MessageEvent<PdfWorkerResponse | PdfWorkerReady>) => {
      const response = event.data;
      if ("type" in response) {
        this.resolveReady();
        return;
      }
      const pending = this.pending.get(response.id);
      if (!pending) return;
      this.pending.delete(response.id);
      if (response.ok) pending.resolve(response.result);
      else pending.reject(new Error(response.error));
    };
    this.worker.onerror = (event) => {
      const error = new Error(event.message || "PDF Worker 意外停止");
      this.rejectReady(error);
      this.renderScheduler.cancelAll(error);
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
    };
  }

  private call<T>(method: PdfWorkerMethod, params: unknown, transfer: Transferable[] = []): Promise<T> {
    const id = this.nextId++;
    const request: PdfWorkerRequest = { id, method, params };
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      this.worker.postMessage(request, transfer);
    });
  }

  private async runRenderTransition<T>(
    reason: string,
    operation: () => Promise<T>,
    committed: (result: T) => boolean,
  ): Promise<T> {
    const transition = this.renderScheduler.beginTransition(new DOMException(reason, "AbortError"));
    try {
      const result = await operation();
      transition.complete(committed(result));
      return result;
    } catch (error) {
      transition.complete(false);
      throw error;
    }
  }

  async open(bytes: Uint8Array, password?: string): Promise<DocumentInfo> {
    await this.readyPromise;
    const owned = new Uint8Array(bytes);
    return this.runRenderTransition(
      "PDF 文档正在切换",
      () => this.call("open", { bytes: owned, password }, [owned.buffer]),
      () => true,
    );
  }

  close(): Promise<void> {
    return this.runRenderTransition(
      "PDF 文档正在关闭",
      () => this.call("close", {}),
      () => true,
    );
  }

  renderPage(request: RenderPageRequest, options: RenderPageOptions): Promise<RenderedPage> {
    return this.renderScheduler.schedule(
      options.scope,
      options.key,
      options.priority,
      () => this.call("renderTile", request),
      options.signal,
    );
  }

  renderSchedulerStats(): RenderSchedulerStats {
    return this.renderScheduler.snapshot();
  }

  prepareViewActivation(): void {
    this.renderScheduler.cancelAll(new DOMException("PDF 标签视图正在切换", "AbortError"));
  }

  extractText(pageIndex: number): Promise<ExtractedText> {
    return this.call("extractText", { pageIndex });
  }

  search(query: string): Promise<SearchHit[]> {
    return this.call("search", { query });
  }

  listLinks(pageIndex: number): Promise<PdfLink[]> {
    return this.call("listLinks", { pageIndex });
  }

  listAnnotations(pageIndex: number): Promise<AnnotationRecord[]> {
    return this.call("listAnnotations", { pageIndex });
  }

  async listAllAnnotations(
    pageCount: number,
    isCancelled: () => boolean = () => false,
  ): Promise<AnnotationRecord[] | null> {
    const annotations: AnnotationRecord[] = [];
    for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
      if (isCancelled()) return null;
      annotations.push(...await this.listAnnotations(pageIndex));
      if ((pageIndex + 1) % 8 === 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    }
    return isCancelled() ? null : annotations;
  }

  applyCommand(command: AnnotationCommand): Promise<EditState> {
    return this.runRenderTransition(
      "PDF 内容正在修改",
      () => this.call("applyCommand", { command }),
      (result) => result.changed,
    );
  }

  undo(): Promise<EditState> {
    return this.runRenderTransition(
      "正在撤销 PDF 修改",
      () => this.call("undo", {}),
      (result) => result.changed,
    );
  }

  redo(): Promise<EditState> {
    return this.runRenderTransition(
      "正在重做 PDF 修改",
      () => this.call("redo", {}),
      (result) => result.changed,
    );
  }

  markSaved(journalKey: string): Promise<EditState> {
    return this.call("markSaved", { journalKey });
  }

  exportPdf(): Promise<ExportedPdf> {
    return this.call("exportPdf", {});
  }

  terminate(): void {
    const error = new Error("PDF Worker 已关闭");
    this.rejectReady(error);
    this.renderScheduler.cancelAll(new DOMException(error.message, "AbortError"));
    this.worker.terminate();
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}
