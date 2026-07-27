import { describe, expect, it } from "vitest";
import { captureDocumentWorkspace, clampPageIndex } from "./store";
import { useWorkspaceStore } from "./store";

describe("clampPageIndex", () => {
  it("keeps navigation inside the current document", () => {
    expect(clampPageIndex(500, 10)).toBe(9);
    expect(clampPageIndex(-2, 10)).toBe(0);
    expect(clampPageIndex(4.8, 10)).toBe(4);
  });

  it("falls back to zero without a document", () => {
    expect(clampPageIndex(20, 0)).toBe(0);
  });
});

describe("annotation selection state", () => {
  it("clears selection for a new document and when a refresh no longer contains it", () => {
    const store = useWorkspaceStore.getState();
    store.setDocument({
      sessionId: null,
      filePath: null,
      fileName: "first.pdf",
      info: {
        title: "",
        pageCount: 1,
        needsPassword: false,
        permissions: { print: true, copy: true, edit: true, annotate: true },
        pages: [{
          index: 0,
          width: 100,
          height: 100,
          displayWidth: 100,
          displayHeight: 100,
          coordinateSpace: { canonicalToPage: [1, 0, 0, 1, 0, 0], pdfOrigin: [0, 0] },
          label: "1",
        }],
      },
    });
    const record = {
      id: "a1",
      pageIndex: 0,
      kind: "note" as const,
      rect: [0, 0, 10, 10] as const,
      contents: "",
      author: "",
      subject: "",
      style: { color: [1, 1, 0] as const, opacity: 1, lineWidth: 1 },
      flags: 4,
    };
    useWorkspaceStore.getState().setAnnotations([record]);
    useWorkspaceStore.getState().setSelectedAnnotationId(record.id);
    useWorkspaceStore.getState().setAnnotations([]);
    expect(useWorkspaceStore.getState().selectedAnnotationId).toBeNull();

    useWorkspaceStore.getState().setAnnotations([record]);
    useWorkspaceStore.getState().setSelectedAnnotationId(record.id);
    useWorkspaceStore.getState().setDocument({
      sessionId: null,
      filePath: null,
      fileName: "second.pdf",
      info: useWorkspaceStore.getState().documentInfo!,
    });
    expect(useWorkspaceStore.getState().annotations).toEqual([]);
    expect(useWorkspaceStore.getState().selectedAnnotationId).toBeNull();
  });
});

describe("document workspace snapshots", () => {
  it("restores independent page and dirty state for a tab", () => {
    const store = useWorkspaceStore.getState();
    store.setPageIndex(0);
    store.setZoom(1.5);
    store.setDirty(true);
    const snapshot = captureDocumentWorkspace(useWorkspaceStore.getState());
    expect(snapshot).not.toBeNull();
    store.clearDocument();
    expect(useWorkspaceStore.getState().documentInfo).toBeNull();
    store.restoreDocument(snapshot!);
    expect(useWorkspaceStore.getState().zoom).toBe(1.5);
    expect(useWorkspaceStore.getState().dirty).toBe(true);
  });
});
