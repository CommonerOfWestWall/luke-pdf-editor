import { create } from "zustand";
import type { AnnotationKind, AnnotationRecord, DocumentInfo } from "../pdf/contracts";

export type WorkspaceTool = "select" | "hand" | AnnotationKind;

export function clampPageIndex(pageIndex: number, pageCount: number): number {
  return Math.min(Math.max(0, Math.trunc(pageIndex)), Math.max(0, pageCount - 1));
}

export interface DocumentWorkspaceSnapshot {
  sessionId: string | null;
  filePath: string | null;
  fileName: string;
  documentInfo: DocumentInfo;
  pageIndex: number;
  zoom: number;
  rotation: 0 | 90 | 180 | 270;
  tool: WorkspaceTool;
  annotations: AnnotationRecord[];
  selectedAnnotationId: string | null;
  dirty: boolean;
  renderRevision: number;
}

export interface WorkspaceState {
  sessionId: string | null;
  filePath: string | null;
  fileName: string | null;
  documentInfo: DocumentInfo | null;
  pageIndex: number;
  zoom: number;
  rotation: 0 | 90 | 180 | 270;
  tool: WorkspaceTool;
  annotations: AnnotationRecord[];
  selectedAnnotationId: string | null;
  dirty: boolean;
  busy: boolean;
  error: string | null;
  renderRevision: number;
  leftPanelOpen: boolean;
  commentsOpen: boolean;
  theme: "light" | "dark";
  viewportSize: { width: number; height: number };
  setDocument: (value: {
    sessionId: string | null;
    filePath: string | null;
    fileName: string;
    info: DocumentInfo;
  }) => void;
  restoreDocument: (snapshot: DocumentWorkspaceSnapshot) => void;
  clearDocument: () => void;
  updateFileLocation: (filePath: string, fileName: string) => void;
  setPageIndex: (pageIndex: number) => void;
  setZoom: (zoom: number) => void;
  rotateClockwise: () => void;
  setTool: (tool: WorkspaceTool) => void;
  setAnnotations: (annotations: AnnotationRecord[]) => void;
  setSelectedAnnotationId: (id: string | null) => void;
  setDirty: (dirty: boolean) => void;
  setBusy: (busy: boolean) => void;
  setError: (error: string | null) => void;
  refreshRender: () => void;
  setViewportSize: (size: { width: number; height: number }) => void;
  toggleLeftPanel: () => void;
  toggleComments: () => void;
  toggleTheme: () => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  sessionId: null,
  filePath: null,
  fileName: null,
  documentInfo: null,
  pageIndex: 0,
  zoom: 1,
  rotation: 0,
  tool: "select",
  annotations: [],
  selectedAnnotationId: null,
  dirty: false,
  busy: false,
  error: null,
  renderRevision: 0,
  leftPanelOpen: true,
  commentsOpen: true,
  theme: "dark",
  viewportSize: { width: 0, height: 0 },
  setDocument: ({ sessionId, filePath, fileName, info }) =>
    set({
      sessionId,
      filePath,
      fileName,
      documentInfo: info,
      pageIndex: 0,
      zoom: 1,
      rotation: 0,
      annotations: [],
      selectedAnnotationId: null,
      dirty: false,
      error: null,
      renderRevision: 0,
    }),
  restoreDocument: (snapshot) => set({ ...snapshot, error: null }),
  clearDocument: () => set({
    sessionId: null,
    filePath: null,
    fileName: null,
    documentInfo: null,
    pageIndex: 0,
    zoom: 1,
    rotation: 0,
    tool: "select",
    annotations: [],
    selectedAnnotationId: null,
    dirty: false,
    error: null,
    renderRevision: 0,
  }),
  updateFileLocation: (filePath, fileName) => set({ filePath, fileName }),
  setPageIndex: (pageIndex) =>
    set((state) => ({ pageIndex: clampPageIndex(pageIndex, state.documentInfo?.pageCount ?? 0) })),
  setZoom: (zoom) => set({ zoom: Math.min(4, Math.max(0.25, zoom)) }),
  rotateClockwise: () => set((state) => ({ rotation: ((state.rotation + 90) % 360) as 0 | 90 | 180 | 270 })),
  setTool: (tool) => set({ tool }),
  setAnnotations: (annotations) => set((state) => ({
    annotations,
    selectedAnnotationId: state.selectedAnnotationId && annotations.some(({ id }) => id === state.selectedAnnotationId)
      ? state.selectedAnnotationId
      : null,
  })),
  setSelectedAnnotationId: (selectedAnnotationId) => set({ selectedAnnotationId }),
  setDirty: (dirty) => set({ dirty }),
  setBusy: (busy) => set({ busy }),
  setError: (error) => set({ error }),
  refreshRender: () => set((state) => ({ renderRevision: state.renderRevision + 1 })),
  setViewportSize: (size) => set({ viewportSize: size }),
  toggleLeftPanel: () => set((state) => ({ leftPanelOpen: !state.leftPanelOpen })),
  toggleComments: () => set((state) => ({ commentsOpen: !state.commentsOpen })),
  toggleTheme: () => set((state) => ({ theme: state.theme === "dark" ? "light" : "dark" })),
}));

export function captureDocumentWorkspace(state: WorkspaceState): DocumentWorkspaceSnapshot | null {
  if (!state.documentInfo || !state.fileName) return null;
  return {
    sessionId: state.sessionId,
    filePath: state.filePath,
    fileName: state.fileName,
    documentInfo: state.documentInfo,
    pageIndex: state.pageIndex,
    zoom: state.zoom,
    rotation: state.rotation,
    tool: state.tool,
    annotations: state.annotations,
    selectedAnnotationId: state.selectedAnnotationId,
    dirty: state.dirty,
    renderRevision: state.renderRevision,
  };
}
