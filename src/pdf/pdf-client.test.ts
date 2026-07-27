import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  DocumentInfo,
  PdfWorkerReady,
  PdfWorkerRequest,
  PdfWorkerResponse,
} from "./contracts";
import { PdfClient } from "./pdf-client";

class FakeWorker {
  static instances: FakeWorker[] = [];

  onmessage: ((event: MessageEvent<PdfWorkerResponse | PdfWorkerReady>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly posted: Array<{ request: PdfWorkerRequest; transfer: Transferable[] }> = [];
  terminated = false;

  constructor() {
    FakeWorker.instances.push(this);
  }

  postMessage(request: PdfWorkerRequest, transfer: Transferable[] = []): void {
    this.posted.push({ request, transfer });
  }

  emit(data: PdfWorkerResponse | PdfWorkerReady): void {
    this.onmessage?.({ data } as MessageEvent<PdfWorkerResponse | PdfWorkerReady>);
  }

  terminate(): void {
    this.terminated = true;
  }
}

const documentInfo: DocumentInfo = {
  title: "startup.pdf",
  pageCount: 1,
  pages: [{
    index: 0,
    width: 612,
    height: 792,
    displayWidth: 612,
    displayHeight: 792,
    coordinateSpace: {
      canonicalToPage: [1, 0, 0, 1, 0, 0],
      pdfOrigin: [0, 0],
    },
    label: "1",
  }],
  needsPassword: false,
  permissions: {
    print: true,
    copy: true,
    edit: true,
    annotate: true,
  },
};

afterEach(() => {
  vi.unstubAllGlobals();
  FakeWorker.instances = [];
});

describe("PdfClient Worker startup", () => {
  it("waits for the Worker ready signal before transferring the PDF", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const client = new PdfClient();
    const worker = FakeWorker.instances[0];
    const openPromise = client.open(new Uint8Array([1, 2, 3]));

    await Promise.resolve();
    expect(worker.posted).toHaveLength(0);

    worker.emit({ type: "ready" });
    await vi.waitFor(() => expect(worker.posted).toHaveLength(1));
    const [{ request, transfer }] = worker.posted;
    expect(request.method).toBe("open");
    expect(transfer).toHaveLength(1);

    worker.emit({ id: request.id, ok: true, result: documentInfo });
    await expect(openPromise).resolves.toEqual(documentInfo);
    client.terminate();
  });
});
