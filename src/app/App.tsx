import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { PrinterIcon, TypeIcon } from "lucide-react";
import { PdfClient } from "../pdf/pdf-client";
import { StandbyClientPool } from "../pdf/standby-client-pool";
import type { AnnotationRecord, DocumentInfo, SearchHit } from "../pdf/contracts";
import {
  CommentIcon,
  FolderIcon,
  HandIcon,
  MoonIcon,
  NoteIcon,
  PanelIcon,
  RedoIcon,
  RotateIcon,
  SaveIcon,
  SearchIcon,
  SelectIcon,
  SunIcon,
  UndoIcon,
} from "./icons";
import {
  captureDocumentWorkspace,
  useWorkspaceStore,
  type DocumentWorkspaceSnapshot,
  type WorkspaceTool,
} from "./store";
import appIcon from "../assets/app-icon.png";
import {
  DocumentViewport,
  type PlacedAnnotationPoint,
  type TextMarkupRequest,
  type TextMarkupSelection,
  type TextMarkupTool,
} from "./DocumentViewport";
import { ThumbnailList } from "./ThumbnailList";
import { canCancelPasswordPrompt, nextPasswordPrompt } from "./password-flow";
import { firstSearchHitPage, nextSearchHitIndex } from "../pdf/navigation";
import { isAllowedExternalUrl } from "./external-url";
import {
  annotationKindLabel,
  annotationToDraft,
  createAnnotationUpdate,
  filterAndSortAnnotations,
  findCreatedAnnotation,
  isAnnotationDraftChanged,
  type AnnotationDraft,
  type AnnotationScope,
} from "./annotation-panel";
import { CommandPalette } from "./CommandPalette";
import type { PaletteCommand } from "./command-palette";
import {
  filterLukeLookAnnotations,
  parseLukeLookReview,
  type LukeLookCategory,
  type LukeLookCategoryFilter,
} from "./luke-look-review";
import { nextTabAfterClose } from "./document-tabs";
import { nextReviewIndex, reviewNavigationIntent } from "./review-navigation";
import {
  ANNOTATION_TOOL_SHORTCUTS,
  annotationToolFromShortcut,
  shortcutForAnnotationTool,
} from "./annotation-shortcuts";
import { AnnotationComposer } from "./AnnotationComposer";
import { PrintPreviewDialog } from "./PrintPreviewDialog";
import { VirtualReviewList } from "./VirtualReviewList";
import packageJson from "../../package.json";

interface NativeSession {
  id: string;
  path: string;
  title: string;
}

interface NativeSaveTarget {
  token: string;
  path: string;
  title: string;
}

interface PendingPasswordDocument {
  bytes: Uint8Array;
  fileName: string;
  session: NativeSession | null;
}

interface DocumentTabRuntime {
  id: string;
  client: PdfClient;
  workspace: DocumentWorkspaceSnapshot;
  mode: WorkspaceMode;
}

interface PendingAnnotation {
  annotation: AnnotationRecord;
  selectionText?: string;
}

const LUKE_LOOK_CATEGORIES: readonly LukeLookCategory[] = [
  "错别字",
  "标点",
  "术语规范",
  "格式规范",
  "事实核查",
  "其他",
];

const TEXT_MARKUP_STYLES: Record<TextMarkupTool, { color: readonly [number, number, number]; opacity: number }> = {
  highlight: { color: [1, 0.85, 0.2], opacity: 0.5 },
  underline: { color: [0.2, 0.65, 0.35], opacity: 1 },
  strikeout: { color: [0.9, 0.25, 0.2], opacity: 1 },
  squiggly: { color: [0.75, 0.35, 0.75], opacity: 1 },
};

function isTextMarkupTool(tool: WorkspaceTool): tool is TextMarkupTool {
  return tool === "highlight" || tool === "underline" || tool === "strikeout" || tool === "squiggly";
}

const TEXT_MARKUP_TOOLS = ANNOTATION_TOOL_SHORTCUTS.filter(
  (entry): entry is typeof entry & { tool: TextMarkupTool } => isTextMarkupTool(entry.tool),
);

type WorkspaceMode = "read" | "comment";

function ToolButton({
  label,
  active = false,
  disabled = false,
  onClick,
  text,
  children,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  text?: string;
  children: React.ReactNode;
}) {
  return (
    <button className={`tool-button${active ? " is-active" : ""}${text ? " has-label" : ""}`} type="button" title={label} aria-label={label} disabled={disabled} onClick={onClick}>
      {children}
      {text && <span>{text}</span>}
    </button>
  );
}

function EmptyWorkspace({ onOpen }: { onOpen: () => void }) {
  return (
    <main className="empty-workspace">
      <div className="empty-hero">
        <div className="empty-illustration" aria-hidden="true">
          <img src={appIcon} alt="" />
        </div>
        <div className="empty-copy">
          <span className="empty-eyebrow">鲁科 Look 审读工作站</span>
          <h1>查看鲁科 Look 审读结果</h1>
          <p>打开鲁科 Look 生成的审读 PDF，逐条定位问题、核对原文与修改建议。文件全程只在本机处理。</p>
          <button className="primary-button" type="button" onClick={onOpen}><FolderIcon />打开审读 PDF</button>
          <small>也支持查看和标注普通 PDF；通用编辑能力将在审读流程完善后继续扩展。</small>
        </div>
      </div>
      <div className="review-steps" aria-label="审读流程">
        <div><strong>01</strong><span>打开审读产物</span><small>识别鲁科 Look 写入的标准 PDF 批注</small></div>
        <div><strong>02</strong><span>逐条核对问题</span><small>在意见与原文之间快速定位</small></div>
        <div><strong>03</strong><span>确认修改依据</span><small>集中查看问题、建议、依据与提示</small></div>
      </div>
    </main>
  );
}

export function App() {
  const inputRef = useRef<HTMLInputElement>(null);
  const startupDocumentsHandledRef = useRef(false);
  const reviewDetailBackRef = useRef<HTMLButtonElement>(null);
  const reviewCardRefs = useRef(new Map<string, HTMLButtonElement>());
  const returningReviewIdRef = useRef<string | null>(null);
  const tabsRef = useRef<DocumentTabRuntime[]>([]);
  const standbyClientsRef = useRef<StandbyClientPool<PdfClient> | null>(null);
  if (!standbyClientsRef.current) {
    standbyClientsRef.current = new StandbyClientPool(() => new PdfClient());
  }
  const standbyClients = standbyClientsRef.current;
  const activeTabIdRef = useRef<string | null>(null);
  const [tabs, setTabs] = useState<DocumentTabRuntime[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [documentEpoch, setDocumentEpoch] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchHits, setSearchHits] = useState<SearchHit[]>([]);
  const [searchHitIndex, setSearchHitIndex] = useState(-1);
  const searchRequestRef = useRef(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>("read");
  const [pendingPassword, setPendingPassword] = useState<PendingPasswordDocument | null>(null);
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [annotationScope, setAnnotationScope] = useState<AnnotationScope>("all");
  const [reviewCategory, setReviewCategory] = useState<LukeLookCategoryFilter>("all");
  const [annotationQuery, setAnnotationQuery] = useState("");
  const [annotationsLoading, setAnnotationsLoading] = useState(false);
  const [annotationDraft, setAnnotationDraft] = useState<AnnotationDraft | null>(null);
  const [showRawEditor, setShowRawEditor] = useState(false);
  const [pendingAnnotation, setPendingAnnotation] = useState<PendingAnnotation | null>(null);
  const [markupRequest, setMarkupRequest] = useState<TextMarkupRequest | null>(null);
  const [reviewCursorId, setReviewCursorId] = useState<string | null>(null);
  const [printPreviewOpen, setPrintPreviewOpen] = useState(false);
  const markupRequestIdRef = useRef(0);
  const preserveDocumentFocusRef = useRef(false);
  const annotationRequestRef = useRef(0);
  const state = useWorkspaceStore();
  const activeTab = tabs.find(({ id }) => id === activeTabId) ?? null;
  const pdfClient = activeTab?.client ?? null;
  const activePage = state.documentInfo?.pages[state.pageIndex];
  const selectedAnnotation = useMemo(
    () => state.annotations.find(({ id }) => id === state.selectedAnnotationId) ?? null,
    [state.annotations, state.selectedAnnotationId],
  );
  const filteredAnnotations = useMemo(() => filterAndSortAnnotations(state.annotations, {
    scope: annotationScope,
    pageIndex: state.pageIndex,
    kind: "all",
    query: annotationQuery,
  }), [annotationQuery, annotationScope, state.annotations, state.pageIndex]);
  const visibleAnnotations = useMemo(
    () => filterLukeLookAnnotations(filteredAnnotations, reviewCategory),
    [filteredAnnotations, reviewCategory],
  );
  const selectedReviewIndex = selectedAnnotation
    ? visibleAnnotations.findIndex(({ id }) => id === selectedAnnotation.id)
    : -1;
  const reviewCursorIndex = reviewCursorId
    ? visibleAnnotations.findIndex(({ id }) => id === reviewCursorId)
    : -1;
  const reviewCursorAnnotation = reviewCursorIndex >= 0
    ? visibleAnnotations[reviewCursorIndex]
    : null;
  const selectedReview = selectedAnnotation ? parseLukeLookReview(selectedAnnotation.contents) : null;
  const reviewDetailReady = Boolean(selectedAnnotation && annotationDraft);

  const commitTabs = useCallback((next: DocumentTabRuntime[]) => {
    tabsRef.current = next;
    setTabs(next);
  }, []);

  const registerReviewCard = useCallback((id: string, element: HTMLButtonElement | null) => {
    if (element) reviewCardRefs.current.set(id, element);
    else reviewCardRefs.current.delete(id);
  }, []);

  const captureActiveTab = useCallback((mode: WorkspaceMode) => {
    const id = activeTabIdRef.current;
    const snapshot = captureDocumentWorkspace(useWorkspaceStore.getState());
    if (!id || !snapshot) return;
    commitTabs(tabsRef.current.map((tab) => (
      tab.id === id ? { ...tab, workspace: snapshot, mode } : tab
    )));
  }, [commitTabs]);

  const resetTransientDocumentUi = useCallback(() => {
    setSearchHits([]);
    setSearchHitIndex(-1);
    searchRequestRef.current += 1;
    annotationRequestRef.current += 1;
    setAnnotationScope("all");
    setReviewCategory("all");
    setAnnotationQuery("");
    setShowRawEditor(false);
    setPendingAnnotation(null);
    setMarkupRequest(null);
    setReviewCursorId(null);
    setPrintPreviewOpen(false);
  }, []);

  const activateTab = useCallback((id: string) => {
    if (id === activeTabIdRef.current || useWorkspaceStore.getState().busy) return;
    captureActiveTab(workspaceMode);
    const target = tabsRef.current.find((tab) => tab.id === id);
    if (!target) return;
    target.client.prepareViewActivation();
    activeTabIdRef.current = id;
    setActiveTabId(id);
    useWorkspaceStore.getState().restoreDocument(target.workspace);
    setWorkspaceMode(target.mode);
    resetTransientDocumentUi();
    setDocumentEpoch((value) => value + 1);
  }, [captureActiveTab, resetTransientDocumentUi, workspaceMode]);

  const closeTab = useCallback(async (id: string) => {
    if (useWorkspaceStore.getState().busy) return;
    if (id === activeTabIdRef.current) captureActiveTab(workspaceMode);
    const closing = tabsRef.current.find((tab) => tab.id === id);
    if (!closing) return;
    if (closing.workspace.dirty && !window.confirm(`“${closing.workspace.fileName}”有尚未保存的修改。关闭标签并放弃这些修改吗？`)) return;
    const tabIds = tabsRef.current.map((tab) => tab.id);
    const nextId = nextTabAfterClose(tabIds, id);
    const nextTabs = tabsRef.current.filter((tab) => tab.id !== id);
    try {
      await closing.client.close();
    } catch {
      // Worker may already be unavailable; terminating below still releases the tab.
    }
    closing.client.terminate();
    commitTabs(nextTabs);
    if (activeTabIdRef.current !== id) return;
    activeTabIdRef.current = nextId;
    setActiveTabId(nextId);
    resetTransientDocumentUi();
    if (!nextId) {
      useWorkspaceStore.getState().clearDocument();
      return;
    }
    const next = nextTabs.find((tab) => tab.id === nextId);
    if (!next) return;
    next.client.prepareViewActivation();
    useWorkspaceStore.getState().restoreDocument(next.workspace);
    setWorkspaceMode(next.mode);
    setDocumentEpoch((value) => value + 1);
  }, [captureActiveTab, commitTabs, resetTransientDocumentUi, workspaceMode]);

  const selectReview = useCallback((annotation: AnnotationRecord) => {
    setReviewCursorId(annotation.id);
    state.setSelectedAnnotationId(annotation.id);
    state.setPageIndex(annotation.pageIndex);
    setShowRawEditor(false);
  }, [state]);

  const navigateReviewList = useCallback((offset: number) => {
    if (!visibleAnnotations.length) return;
    const nextIndex = nextReviewIndex(
      reviewCursorIndex,
      visibleAnnotations.length,
      offset < 0 ? -1 : 1,
    );
    if (nextIndex < 0) return;
    const annotation = visibleAnnotations[nextIndex];
    setReviewCursorId(annotation.id);
    state.setPageIndex(annotation.pageIndex);
  }, [reviewCursorIndex, state, visibleAnnotations]);

  const navigateReview = useCallback((offset: number) => {
    if (!visibleAnnotations.length) return;
    const nextIndex = nextReviewIndex(
      selectedReviewIndex,
      visibleAnnotations.length,
      offset < 0 ? -1 : 1,
    );
    if (nextIndex < 0) return;
    selectReview(visibleAnnotations[nextIndex]);
  }, [selectReview, selectedReviewIndex, visibleAnnotations]);

  const loadDocument = useCallback(async (bytes: Uint8Array, fileName: string, session: NativeSession | null, documentPassword?: string) => {
    state.setBusy(true);
    state.setError(null);
    const client = standbyClients.take();
    try {
      const info = await client.open(bytes, documentPassword);
      captureActiveTab(workspaceMode);
      state.setDocument({ sessionId: session?.id ?? null, filePath: session?.path ?? null, fileName, info });
      const snapshot = captureDocumentWorkspace(useWorkspaceStore.getState());
      if (!snapshot) throw new Error("无法创建文档工作区");
      const id = crypto.randomUUID();
      const nextTabs = [...tabsRef.current, { id, client, workspace: snapshot, mode: "read" as const }];
      commitTabs(nextTabs);
      activeTabIdRef.current = id;
      setActiveTabId(id);
      setDocumentEpoch((value) => value + 1);
      resetTransientDocumentUi();
      setPendingPassword(null);
      setPassword("");
      setPasswordError(null);
      setWorkspaceMode("read");
      state.setTool("select");
      if (!useWorkspaceStore.getState().commentsOpen) state.toggleComments();
    } catch (error) {
      client.terminate();
      if (error instanceof Error && error.message === "PASSWORD_REQUIRED") {
        setPendingPassword({ bytes: new Uint8Array(bytes), fileName, session });
        const prompt = nextPasswordPrompt(password, documentPassword);
        setPassword(prompt.password);
        setPasswordError(prompt.error);
      } else {
        state.setError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      state.setBusy(false);
    }
  }, [captureActiveTab, commitTabs, password, resetTransientDocumentUi, standbyClients, state, workspaceMode]);

  const submitPassword = useCallback(async (event: React.FormEvent) => {
    event.preventDefault();
    if (!pendingPassword || !password) return;
    await loadDocument(pendingPassword.bytes, pendingPassword.fileName, pendingPassword.session, password);
  }, [loadDocument, password, pendingPassword]);

  const cancelPassword = useCallback(() => {
    if (!canCancelPasswordPrompt(useWorkspaceStore.getState().busy)) return;
    setPendingPassword(null);
    setPassword("");
    setPasswordError(null);
  }, []);

  const openDocument = useCallback(async () => {
    if (useWorkspaceStore.getState().busy) return;
    if (isTauri()) {
      state.setBusy(true);
      try {
        const session = await invoke<NativeSession | null>("open_document_dialog");
        if (!session) return;
        const buffer = await invoke<ArrayBuffer>("read_document", { sessionId: session.id });
        await loadDocument(new Uint8Array(buffer), session.title, session);
      } catch (error) {
        state.setError(String(error));
      } finally {
        state.setBusy(false);
      }
      return;
    }
    inputRef.current?.click();
  }, [loadDocument, state]);

  useEffect(() => {
    if (!isTauri() || startupDocumentsHandledRef.current) return;
    // React Strict Mode immediately runs an effect setup/cleanup/setup cycle.
    // Starting a PDF Worker in the first setup races with the Worker-pool cleanup
    // below and leaves its open promise pending forever. Only begin after that
    // probe cycle; cleanup cancels the first timer before it consumes the paths.
    const timerId = window.setTimeout(() => {
      if (startupDocumentsHandledRef.current) return;
      startupDocumentsHandledRef.current = true;
      void (async () => {
        try {
          const sessions = await invoke<NativeSession[]>("take_startup_documents");
          for (const session of sessions) {
            const buffer = await invoke<ArrayBuffer>("read_document", { sessionId: session.id });
            await loadDocument(new Uint8Array(buffer), session.title, session);
          }
        } catch (error) {
          useWorkspaceStore.getState().setError(String(error));
        }
      })();
    }, 0);
    return () => window.clearTimeout(timerId);
  }, [loadDocument]);

  const onBrowserFile = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (useWorkspaceStore.getState().busy) return;
    const files = Array.from(event.target.files ?? []);
    for (const file of files) {
      await loadDocument(new Uint8Array(await file.arrayBuffer()), file.name, null);
    }
    event.target.value = "";
  }, [loadDocument]);

  const saveDocument = useCallback(async (saveAs = false) => {
    if (!pdfClient || !state.documentInfo || useWorkspaceStore.getState().busy) return;
    state.setBusy(true);
    state.setError(null);
    try {
      let saveTarget: NativeSaveTarget | null = null;
      if (isTauri() && state.sessionId && saveAs) {
        saveTarget = await invoke<NativeSaveTarget | null>("choose_save_target", { sessionId: state.sessionId });
        if (!saveTarget) return;
      }
      const exported = await pdfClient.exportPdf();
      if (isTauri() && state.sessionId) {
        if (saveTarget) {
          const session = await invoke<NativeSession>("save_document_as", exported.bytes, { headers: { "x-save-target": saveTarget.token } });
          state.updateFileLocation(session.path, session.title);
        } else {
          await invoke("save_document", exported.bytes, { headers: { "x-document-session": state.sessionId } });
        }
      } else {
        const url = URL.createObjectURL(new Blob([Uint8Array.from(exported.bytes).buffer], { type: "application/pdf" }));
        const link = window.document.createElement("a");
        link.href = url;
        link.download = state.fileName ?? "document.pdf";
        link.click();
        // 立即回收可能在部分浏览器中取消尚未开始的下载，延迟到下载接管后再释放。
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      }
      const editState = await pdfClient.markSaved(exported.journalKey);
      state.setDirty(editState.dirty);
    } catch (error) {
      state.setError(error instanceof Error ? error.message : String(error));
    } finally {
      state.setBusy(false);
    }
  }, [pdfClient, state]);

  const refreshAnnotations = useCallback(async () => {
    if (!pdfClient || !useWorkspaceStore.getState().documentInfo) return;
    const requestId = ++annotationRequestRef.current;
    setAnnotationsLoading(true);
    try {
      const pageCount = useWorkspaceStore.getState().documentInfo?.pageCount ?? 0;
      const annotations = await pdfClient.listAllAnnotations(
        pageCount,
        () => requestId !== annotationRequestRef.current,
      );
      if (annotations && requestId === annotationRequestRef.current) {
        useWorkspaceStore.getState().setAnnotations(annotations);
        return annotations;
      }
      return null;
    } catch (error) {
      if (requestId === annotationRequestRef.current) {
        useWorkspaceStore.getState().setError(error instanceof Error ? error.message : String(error));
      }
      return null;
    } finally {
      if (requestId === annotationRequestRef.current) setAnnotationsLoading(false);
    }
  }, [pdfClient]);

  const startPlacementTool = useCallback((kind: "note" | "freeText", toggle = true) => {
    if (!state.documentInfo?.permissions.annotate || state.busy) return;
    setWorkspaceMode("comment");
    if (!state.commentsOpen) state.toggleComments();
    state.setTool(toggle && state.tool === kind ? "select" : kind);
  }, [state]);

  const activateTextMarkupTool = useCallback((tool: TextMarkupTool, requestCurrentSelection = false) => {
    if (
      !state.documentInfo?.permissions.annotate
      || !state.documentInfo.permissions.copy
      || state.busy
    ) return;
    setWorkspaceMode("comment");
    if (!state.commentsOpen) state.toggleComments();
    const selection = window.getSelection();
    const hasSelection = Boolean(selection && !selection.isCollapsed && selection.rangeCount > 0);
    if (!requestCurrentSelection && state.tool === tool && !hasSelection) {
      state.setTool("select");
      return;
    }
    state.setTool(tool);
    if (requestCurrentSelection || hasSelection) {
      setMarkupRequest({ id: ++markupRequestIdRef.current, tool });
    }
  }, [state]);

  const placeAnnotation = useCallback((placement: PlacedAnnotationPoint) => {
    const page = state.documentInfo?.pages[placement.pageIndex];
    const kind = useWorkspaceStore.getState().tool;
    if (!page || (kind !== "note" && kind !== "freeText")) return;
    const [x, y] = placement.point;
    const now = new Date().toISOString();
    const annotation: AnnotationRecord = {
      id: crypto.randomUUID(),
      pageIndex: placement.pageIndex,
      kind,
      rect: kind === "note"
        ? [
          Math.max(0, x - 12),
          Math.max(0, y - 12),
          Math.min(page.width, x + 12),
          Math.min(page.height, y + 12),
        ]
        : [
          Math.max(0, Math.min(x, page.width - 180)),
          Math.max(0, Math.min(y - 52, page.height - 52)),
          Math.min(page.width, Math.max(180, x + 180)),
          Math.min(page.height, Math.max(52, y)),
        ],
      contents: "",
      author: "鲁科用户",
      subject: kind === "note" ? "便签" : "文本框",
      createdAt: now,
      modifiedAt: now,
      style: kind === "note"
        ? { color: [1, 0.78, 0.18], opacity: 1, lineWidth: 1 }
        : { color: [0.12, 0.18, 0.28], opacity: 1, lineWidth: 1, fontSize: 12 },
      flags: 4,
    };
    setPendingAnnotation({ annotation });
  }, [state.documentInfo]);

  const commitNewAnnotation = useCallback(async (
    annotation: AnnotationRecord,
    options: { keepTool?: boolean; openEditor?: boolean; preserveDocumentFocus?: boolean } = {},
  ): Promise<boolean> => {
    if (!pdfClient || useWorkspaceStore.getState().busy) return false;
    const annotationsBeforeCreate = useWorkspaceStore.getState().annotations;
    state.setBusy(true);
    state.setError(null);
    try {
      const editState = await pdfClient.applyCommand({ type: "create", annotation });
      state.setDirty(editState.dirty);
      if (!state.commentsOpen) state.toggleComments();
      state.refreshRender();
      if (!options.keepTool) state.setTool("select");
      const refreshedAnnotations = await refreshAnnotations();
      const createdAnnotation = refreshedAnnotations
        ? findCreatedAnnotation(annotationsBeforeCreate, refreshedAnnotations, annotation)
        : null;
      const selectedId = createdAnnotation?.id ?? annotation.id;
      preserveDocumentFocusRef.current = Boolean(options.preserveDocumentFocus);
      setReviewCursorId(selectedId);
      state.setSelectedAnnotationId(selectedId);
      setShowRawEditor(Boolean(options.openEditor));
      return true;
    } catch (error) {
      state.setError(error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      state.setBusy(false);
    }
  }, [pdfClient, refreshAnnotations, state]);

  const createTextMarkup = useCallback((selection: TextMarkupSelection) => {
    if (!state.documentInfo?.permissions.annotate || useWorkspaceStore.getState().busy) return;
    const now = new Date().toISOString();
    const annotation: AnnotationRecord = {
      id: crypto.randomUUID(),
      pageIndex: selection.pageIndex,
      kind: selection.kind,
      rect: selection.rect,
      quadPoints: selection.quadPoints,
      contents: "",
      author: "鲁科用户",
      subject: annotationKindLabel(selection.kind),
      createdAt: now,
      modifiedAt: now,
      style: { ...TEXT_MARKUP_STYLES[selection.kind], lineWidth: 1 },
      flags: 4,
    };
    void commitNewAnnotation(annotation, {
      keepTool: true,
      openEditor: true,
      preserveDocumentFocus: true,
    });
  }, [commitNewAnnotation, state.documentInfo?.permissions.annotate]);

  const submitPendingAnnotation = useCallback(async (contents: string) => {
    if (!pendingAnnotation) return;
    const annotation = {
      ...pendingAnnotation.annotation,
      contents,
      modifiedAt: new Date().toISOString(),
    };
    if (await commitNewAnnotation(annotation)) setPendingAnnotation(null);
  }, [commitNewAnnotation, pendingAnnotation]);

  const undo = useCallback(async () => {
    if (!pdfClient || !state.documentInfo || useWorkspaceStore.getState().busy) return;
    state.setBusy(true);
    try {
      const editState = await pdfClient.undo();
      if (!editState.changed) return;
      state.setDirty(editState.dirty);
      state.refreshRender();
      await refreshAnnotations();
    } catch (error) {
      state.setError(error instanceof Error ? error.message : String(error));
    } finally {
      state.setBusy(false);
    }
  }, [pdfClient, refreshAnnotations, state]);

  const redo = useCallback(async () => {
    if (!pdfClient || !state.documentInfo || useWorkspaceStore.getState().busy) return;
    state.setBusy(true);
    try {
      const editState = await pdfClient.redo();
      if (!editState.changed) return;
      state.setDirty(editState.dirty);
      state.refreshRender();
      await refreshAnnotations();
    } catch (error) {
      state.setError(error instanceof Error ? error.message : String(error));
    } finally {
      state.setBusy(false);
    }
  }, [pdfClient, refreshAnnotations, state]);

  const updateSelectedAnnotation = useCallback(async (event: React.FormEvent) => {
    event.preventDefault();
    if (!pdfClient || !selectedAnnotation || !annotationDraft || !state.documentInfo?.permissions.annotate || useWorkspaceStore.getState().busy) return;
    const after = createAnnotationUpdate(selectedAnnotation, annotationDraft);
    state.setBusy(true);
    state.setError(null);
    try {
      const editState = await pdfClient.applyCommand({ type: "update", before: selectedAnnotation, after });
      state.setDirty(editState.dirty);
      state.refreshRender();
      await refreshAnnotations();
    } catch (error) {
      state.setError(error instanceof Error ? error.message : String(error));
    } finally {
      state.setBusy(false);
    }
  }, [annotationDraft, pdfClient, refreshAnnotations, selectedAnnotation, state]);

  const deleteSelectedAnnotation = useCallback(async () => {
    if (!pdfClient || !selectedAnnotation || !state.documentInfo?.permissions.annotate || useWorkspaceStore.getState().busy) return;
    if (!window.confirm(`删除第 ${selectedAnnotation.pageIndex + 1} 页的${annotationKindLabel(selectedAnnotation.kind)}批注？可在保存前撤销。`)) return;
    state.setBusy(true);
    state.setError(null);
    try {
      const editState = await pdfClient.applyCommand({ type: "delete", annotation: selectedAnnotation });
      state.setDirty(editState.dirty);
      state.setSelectedAnnotationId(null);
      state.refreshRender();
      await refreshAnnotations();
    } catch (error) {
      state.setError(error instanceof Error ? error.message : String(error));
    } finally {
      state.setBusy(false);
    }
  }, [pdfClient, refreshAnnotations, selectedAnnotation, state]);

  const runSearch = useCallback(async () => {
    if (!pdfClient) return;
    if (!searchQuery.trim()) return setSearchHits([]);
    const requestId = ++searchRequestRef.current;
    const query = searchQuery.trim();
    state.setBusy(true);
    try {
      const hits = await pdfClient.search(query);
      if (requestId !== searchRequestRef.current) return;
      setSearchHits(hits);
      const firstPage = firstSearchHitPage(hits);
      setSearchHitIndex(firstPage === null ? -1 : 0);
      if (firstPage !== null) state.setPageIndex(firstPage);
    } catch (error) {
      if (requestId === searchRequestRef.current) {
        state.setError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      state.setBusy(false);
    }
  }, [pdfClient, searchQuery, state]);

  const navigateSearch = useCallback((direction: 1 | -1) => {
    const nextIndex = nextSearchHitIndex(searchHits.length, searchHitIndex, direction);
    if (nextIndex === null) return;
    setSearchHitIndex(nextIndex);
    state.setPageIndex(searchHits[nextIndex].pageIndex);
  }, [searchHitIndex, searchHits, state]);

  const handleRenderError = useCallback((error: Error) => {
    state.setError(error.message);
  }, [state.setError]);

  const openExternalLink = useCallback(async (url: string) => {
    if (!isAllowedExternalUrl(url)) {
      state.setError("已阻止 PDF 中不安全的外部链接");
      return;
    }
    if (!window.confirm(`即将在系统默认应用中打开外部链接：\n\n${url}\n\n是否继续？`)) return;
    try {
      if (isTauri()) await invoke("open_external_url", { url });
      else window.open(url, "_blank", "noopener,noreferrer");
    } catch (error) {
      state.setError(error instanceof Error ? error.message : String(error));
    }
  }, [state]);

  const closeSearch = useCallback(() => {
    searchRequestRef.current += 1;
    setSearchOpen(false);
    setSearchHits([]);
    setSearchHitIndex(-1);
  }, []);

  useEffect(() => {
    if (!state.documentInfo) return;
    void refreshAnnotations();
    return () => { annotationRequestRef.current += 1; };
  }, [documentEpoch, refreshAnnotations, state.documentInfo]);

  useEffect(() => {
    setAnnotationDraft(selectedAnnotation ? annotationToDraft(selectedAnnotation) : null);
  }, [selectedAnnotation]);

  useEffect(() => {
    if (state.selectedAnnotationId && reviewDetailReady) {
      if (preserveDocumentFocusRef.current) {
        preserveDocumentFocusRef.current = false;
        return;
      }
      reviewDetailBackRef.current?.focus();
      return;
    }
    const returningReviewId = returningReviewIdRef.current;
    if (!returningReviewId) return;
    returningReviewIdRef.current = null;
    reviewCardRefs.current.get(returningReviewId)?.focus();
  }, [reviewDetailReady, state.selectedAnnotationId]);

  useEffect(() => {
    if (!reviewCursorId || state.selectedAnnotationId) return;
    const card = reviewCardRefs.current.get(reviewCursorId);
    card?.focus({ preventScroll: true });
    card?.scrollIntoView({ block: "nearest" });
  }, [reviewCursorId, state.selectedAnnotationId]);

  useEffect(() => {
    if (reviewCursorId && !visibleAnnotations.some(({ id }) => id === reviewCursorId)) {
      setReviewCursorId(null);
    }
  }, [reviewCursorId, visibleAnnotations]);

  useEffect(() => {
    if (
      annotationScope === "page"
      && selectedAnnotation
      && selectedAnnotation.pageIndex !== state.pageIndex
    ) {
      state.setSelectedAnnotationId(null);
      setShowRawEditor(false);
    }
  }, [annotationScope, selectedAnnotation, state]);

  useEffect(() => {
    document.documentElement.dataset.theme = state.theme;
  }, [state.theme]);

  useEffect(() => {
    if (isTauri()) return;
    const protectUnsavedWork = (event: BeforeUnloadEvent) => {
      const hasDirtyDocument = state.dirty || tabsRef.current.some((tab) => (
        tab.id !== activeTabIdRef.current && tab.workspace.dirty
      ));
      if (!hasDirtyDocument) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", protectUnsavedWork);
    return () => window.removeEventListener("beforeunload", protectUnsavedWork);
  }, [state.dirty]);

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void getCurrentWindow().onCloseRequested((event) => {
      const currentDirty = useWorkspaceStore.getState().dirty;
      const hasDirtyDocument = currentDirty || tabsRef.current.some((tab) => (
        tab.id !== activeTabIdRef.current && tab.workspace.dirty
      ));
      if (hasDirtyDocument && !window.confirm("仍有文档包含尚未保存的批注。仍要关闭鲁科 PDF 编辑器吗？")) {
        event.preventDefault();
      }
    }).then((dispose) => {
      if (disposed) dispose();
      else unlisten = dispose;
    }).catch((error) => useWorkspaceStore.getState().setError(String(error)));
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    // WebView2 may not finish bootstrapping a module Worker when its first
    // large transferable is posted in the same file-input task. Keep one
    // initialized client ready, and recreate it after Strict Mode cleanup.
    standbyClients.start();
    return () => {
      tabsRef.current.forEach(({ client }) => client.terminate());
      standbyClients.stop();
    };
  }, [standbyClients]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      const isEditingText = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || (target instanceof HTMLElement && target.isContentEditable);
      if (pendingAnnotation) {
        if (event.key === "Escape") {
          event.preventDefault();
          setPendingAnnotation(null);
          state.setTool("select");
          return;
        }
      }
      if (printPreviewOpen) {
        if (event.key === "Escape") {
          event.preventDefault();
          setPrintPreviewOpen(false);
        }
        return;
      }
      if (pendingPassword) {
        if (event.ctrlKey && ["o", "s", "f", "k", "p", "z", "y"].includes(event.key.toLowerCase())) event.preventDefault();
        if (event.key === "Escape" && !state.busy) cancelPassword();
        return;
      }
      if (commandPaletteOpen) {
        if (event.ctrlKey && ["o", "s", "f", "k"].includes(event.key.toLowerCase())) event.preventDefault();
        if ((event.ctrlKey && event.key.toLowerCase() === "k") || event.key === "Escape") {
          event.preventDefault();
          setCommandPaletteOpen(false);
        }
        return;
      }
      if (state.busy && event.ctrlKey && ["o", "s", "z", "y"].includes(event.key.toLowerCase())) {
        event.preventDefault();
        return;
      }
      if (event.ctrlKey && event.key.toLowerCase() === "o") { event.preventDefault(); void openDocument(); }
      if (event.ctrlKey && event.key.toLowerCase() === "s") { event.preventDefault(); void saveDocument(event.shiftKey); }
      if (event.ctrlKey && event.key.toLowerCase() === "f") { event.preventDefault(); setSearchOpen(true); }
      if (event.ctrlKey && event.key.toLowerCase() === "k") { event.preventDefault(); setCommandPaletteOpen((open) => !open); }
      if (event.ctrlKey && event.key.toLowerCase() === "p" && state.documentInfo?.permissions.print) { event.preventDefault(); setPrintPreviewOpen(true); }
      if (!isEditingText && state.documentInfo && event.ctrlKey && event.key.toLowerCase() === "z") { event.preventDefault(); void undo(); }
      if (!isEditingText && state.documentInfo && event.ctrlKey && event.key.toLowerCase() === "y") { event.preventDefault(); void redo(); }
      if (
        !isEditingText
        && event.key === "Enter"
        && state.commentsOpen
        && !selectedAnnotation
        && reviewCursorAnnotation
      ) {
        event.preventDefault();
        selectReview(reviewCursorAnnotation);
        return;
      }
      const annotationTool = !isEditingText && state.documentInfo && !commandPaletteOpen && !searchOpen
        ? annotationToolFromShortcut(event)
        : null;
      if (annotationTool) {
        const canUseTool = Boolean(state.documentInfo?.permissions.annotate)
          && (!isTextMarkupTool(annotationTool) || Boolean(state.documentInfo?.permissions.copy))
          && !state.busy;
        if (canUseTool) {
          event.preventDefault();
          if (isTextMarkupTool(annotationTool)) activateTextMarkupTool(annotationTool, true);
          else startPlacementTool(annotationTool, false);
        }
        return;
      }
      if (!isEditingText && state.documentInfo && !commandPaletteOpen && !searchOpen) {
        const navigation = reviewNavigationIntent(
          event.key,
          state.commentsOpen && visibleAnnotations.length > 0,
          Boolean(selectedAnnotation),
        );
        if (navigation?.scope === "detail") {
          event.preventDefault();
          navigateReview(navigation.offset);
        } else if (navigation?.scope === "list") {
          event.preventDefault();
          navigateReviewList(navigation.offset);
        } else if (navigation?.scope === "page") {
          event.preventDefault();
          state.setPageIndex(state.pageIndex + navigation.offset);
        } else if (event.key === "PageDown" || event.key === "ArrowRight") { event.preventDefault(); state.setPageIndex(state.pageIndex + 1); }
        else if (event.key === "PageUp" || event.key === "ArrowLeft") { event.preventDefault(); state.setPageIndex(state.pageIndex - 1); }
        else if (event.key === "Home") { event.preventDefault(); state.setPageIndex(0); }
        else if (event.key === "End") { event.preventDefault(); state.setPageIndex(state.documentInfo.pageCount - 1); }
      }
      if (event.key === "Escape") {
        if (searchOpen) closeSearch();
        else state.setTool("select");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activateTextMarkupTool, cancelPassword, closeSearch, commandPaletteOpen, navigateReview, navigateReviewList, openDocument, pendingAnnotation, pendingPassword, printPreviewOpen, redo, reviewCursorAnnotation, saveDocument, searchOpen, selectedAnnotation, selectReview, startPlacementTool, state, undo, visibleAnnotations.length]);

  const pageLabel = useMemo(() => state.documentInfo ? `${state.pageIndex + 1} / ${state.documentInfo.pageCount}` : "—", [state.documentInfo, state.pageIndex]);
  const fitZoom = useMemo(() => {
    if (!activePage || !state.viewportSize.width) return null;
    const rotated = state.rotation === 90 || state.rotation === 270;
    const pageWidth = rotated ? activePage.displayHeight : activePage.displayWidth;
    const pageHeight = rotated ? activePage.displayWidth : activePage.displayHeight;
    const availableWidth = Math.max(0, state.viewportSize.width - 56);
    const availableHeight = Math.max(0, state.viewportSize.height - 56);
    return { width: availableWidth / pageWidth, page: Math.min(availableWidth / pageWidth, availableHeight / pageHeight) };
  }, [activePage, state.rotation, state.viewportSize]);
  const zoomPresets = [0.5, 0.75, 1, 1.25, 1.5, 2, 4];
  const zoomPresetValue = zoomPresets.find((preset) => Math.abs(state.zoom - preset) < 0.005) ? String(zoomPresets.find((preset) => Math.abs(state.zoom - preset) < 0.005)) : "custom";
  const [pageDraft, setPageDraft] = useState("");
  useEffect(() => { setPageDraft(state.documentInfo ? String(state.pageIndex + 1) : ""); }, [state.documentInfo, state.pageIndex]);
  const selectTool = (tool: WorkspaceTool) => state.setTool(tool);
  const paletteCommands = useMemo<PaletteCommand[]>(() => [
    { id: "open", label: "打开 PDF", category: "文件", shortcut: "Ctrl+O", keywords: ["open"], disabled: state.busy, run: () => void openDocument() },
    { id: "save", label: "保存文档", category: "文件", shortcut: "Ctrl+S", keywords: ["save"], disabled: !state.documentInfo || !state.dirty || state.busy, run: () => void saveDocument() },
    { id: "print", label: "打印预览", category: "文件", shortcut: "Ctrl+P", keywords: ["print"], disabled: !state.documentInfo?.permissions.print || state.busy, restoreFocusAfterRun: false, run: () => setPrintPreviewOpen(true) },
    { id: "find", label: "在文档中查找", category: "导航", shortcut: "Ctrl+F", keywords: ["search"], disabled: !state.documentInfo, restoreFocusAfterRun: false, run: () => setSearchOpen(true) },
    { id: "read-mode", label: "切换到审读工作区", category: "工作区", keywords: ["read", "review"], run: () => { setWorkspaceMode("read"); state.setTool("select"); if (!state.commentsOpen) state.toggleComments(); } },
    { id: "comment-mode", label: "切换到标注工作区", category: "工作区", keywords: ["annotate", "comment"], run: () => { setWorkspaceMode("comment"); if (!state.commentsOpen) state.toggleComments(); } },
    ...TEXT_MARKUP_TOOLS.map(({ tool, label, shortcut }) => ({
      id: `markup-${tool}`,
      label,
      category: "批注",
      shortcut,
      keywords: [tool],
      disabled: !state.documentInfo?.permissions.annotate || !state.documentInfo?.permissions.copy || state.busy,
      run: () => activateTextMarkupTool(tool, true),
    })),
    { id: "add-note", label: "放置便签", category: "批注", shortcut: shortcutForAnnotationTool("note"), keywords: ["note"], disabled: !state.documentInfo?.permissions.annotate || state.busy, run: () => startPlacementTool("note") },
    { id: "add-text-box", label: "放置文本框", category: "批注", shortcut: shortcutForAnnotationTool("freeText"), keywords: ["free text"], disabled: !state.documentInfo?.permissions.annotate || state.busy, run: () => startPlacementTool("freeText") },
    { id: "zoom-in", label: "放大", category: "视图", disabled: !state.documentInfo, run: () => state.setZoom(state.zoom + 0.1) },
    { id: "zoom-out", label: "缩小", category: "视图", disabled: !state.documentInfo, run: () => state.setZoom(state.zoom - 0.1) },
    { id: "rotate", label: "顺时针旋转", category: "视图", disabled: !state.documentInfo, run: state.rotateClockwise },
    { id: "toggle-navigation", label: `${state.leftPanelOpen ? "隐藏" : "显示"}导航面板`, category: "面板", run: state.toggleLeftPanel },
    { id: "toggle-comments", label: `${state.commentsOpen ? "隐藏" : "显示"}批注面板`, category: "面板", run: state.toggleComments },
    { id: "toggle-theme", label: `切换到${state.theme === "dark" ? "浅色" : "深色"}主题`, category: "外观", run: state.toggleTheme },
  ], [
    activateTextMarkupTool,
    openDocument,
    saveDocument,
    startPlacementTool,
    state.busy,
    state.commentsOpen,
    state.dirty,
    state.documentInfo,
    state.leftPanelOpen,
    state.rotateClockwise,
    state.setTool,
    state.setZoom,
    state.theme,
    state.toggleComments,
    state.toggleLeftPanel,
    state.toggleTheme,
    state.zoom,
  ]);

  return (
    <div className={`app-shell${state.documentInfo ? "" : " is-empty"}`} aria-busy={state.busy}>
      <input ref={inputRef} type="file" accept="application/pdf,.pdf" multiple hidden onChange={onBrowserFile} />
      <header className="titlebar">
        <div className="brand-mark" aria-hidden="true"><img src={appIcon} alt="" /></div>
        <strong>鲁科 PDF 编辑器</strong>
        <div className="document-tabs" role="tablist" aria-label="已打开的 PDF">
          {tabs.map((tab) => {
            const active = tab.id === activeTabId;
            const dirty = active ? state.dirty : tab.workspace.dirty;
            return (
              <div className={`document-tab${active ? " is-active" : ""}`} key={tab.id}>
                <button
                  className="document-tab-main"
                  type="button"
                  role="tab"
                  aria-selected={active}
                  title={tab.workspace.fileName}
                  onClick={() => activateTab(tab.id)}
                >
                  <span className={dirty ? "dirty-dot" : "file-dot"} />
                  <span>{tab.workspace.fileName}</span>
                </button>
                <button className="document-tab-close" type="button" aria-label={`关闭 ${tab.workspace.fileName}`} onClick={() => void closeTab(tab.id)}>×</button>
              </div>
            );
          })}
          {tabs.length > 0 && <button className="new-tab-button" type="button" aria-label="打开另一个 PDF" title="打开另一个 PDF" onClick={() => void openDocument()}>+</button>}
        </div>
        <div className="titlebar-spacer" />
        <button className="command-launch" type="button" onClick={() => setCommandPaletteOpen(true)} aria-label="搜索命令，快捷键 Ctrl+K"><SearchIcon /><span>搜索命令</span><kbd>Ctrl K</kbd></button>
        <span className="version-badge">v{packageJson.version}</span>
      </header>

      {state.documentInfo && <nav className="workspace-modebar" aria-label="工作区模式">
        <div className="workspace-modes">
          <button className={workspaceMode === "read" ? "is-active" : ""} type="button" aria-pressed={workspaceMode === "read"} onClick={() => { setWorkspaceMode("read"); state.setTool("select"); if (!state.commentsOpen) state.toggleComments(); }}>审读</button>
          <button className={workspaceMode === "comment" ? "is-active" : ""} type="button" aria-pressed={workspaceMode === "comment"} onClick={() => { setWorkspaceMode("comment"); if (!state.commentsOpen) state.toggleComments(); }}>标注</button>
        </div>
        {workspaceMode === "comment" ? (
          <div className="context-tools" aria-label="批注工具">
            {TEXT_MARKUP_TOOLS.map(({ tool, label, shortcut }) => (
              <button
                key={tool}
                type="button"
                className={state.tool === tool ? "is-active" : ""}
                aria-label={`${label} (${shortcut})`}
                aria-pressed={state.tool === tool}
                disabled={!state.documentInfo?.permissions.annotate || !state.documentInfo?.permissions.copy || state.busy}
                title={state.documentInfo?.permissions.copy ? `${shortcut} · ${label}：先选工具或先选文字均可` : "此 PDF 不允许复制文本，无法创建文字标记"}
                onClick={() => activateTextMarkupTool(tool)}
              >
                <i className={`tool-swatch ${tool}`} />{label}<kbd>{shortcut}</kbd>
              </button>
            ))}
            <span className="context-separator" />
            <button
              type="button"
              className={state.tool === "note" ? "is-active" : ""}
              aria-label={`便签 (${shortcutForAnnotationTool("note")})`}
              aria-pressed={state.tool === "note"}
              disabled={!state.documentInfo?.permissions.annotate || state.busy}
              title={`${shortcutForAnnotationTool("note")} · 选择后点击页面放置便签`}
              onClick={() => startPlacementTool("note")}
            ><NoteIcon />便签<kbd>{shortcutForAnnotationTool("note")}</kbd></button>
            <button
              type="button"
              className={state.tool === "freeText" ? "is-active" : ""}
              aria-label={`文本框 (${shortcutForAnnotationTool("freeText")})`}
              aria-pressed={state.tool === "freeText"}
              disabled={!state.documentInfo?.permissions.annotate || state.busy}
              title={`${shortcutForAnnotationTool("freeText")} · 选择后点击页面放置文本框`}
              onClick={() => startPlacementTool("freeText")}
            ><TypeIcon />文本框<kbd>{shortcutForAnnotationTool("freeText")}</kbd></button>
            <span className="context-separator" />
            <button type="button" disabled title="0.3c：墨迹与图形">墨迹与图形 <small>下一批</small></button>
          </div>
        ) : (
          <div className="context-tools read-context" aria-label="审读工具提示"><span>审读模式</span><small>逐条核对鲁科 Look 意见并定位原文</small></div>
        )}
      </nav>}

      {state.documentInfo && <div className="commandbar">
        <div className="command-group">
          <ToolButton label="打开 PDF (Ctrl+O)" disabled={state.busy} onClick={() => void openDocument()}><FolderIcon /></ToolButton>
          <ToolButton label="保存 (Ctrl+S)" disabled={!state.documentInfo || !state.dirty || state.busy} onClick={() => void saveDocument()}><SaveIcon /></ToolButton>
          <ToolButton label="打印预览 (Ctrl+P)" disabled={!state.documentInfo?.permissions.print || state.busy} onClick={() => setPrintPreviewOpen(true)}><PrinterIcon /></ToolButton>
          <ToolButton label="撤销 (Ctrl+Z)" disabled={!state.documentInfo || state.busy} onClick={() => void undo()}><UndoIcon /></ToolButton>
          <ToolButton label="重做 (Ctrl+Y)" disabled={!state.documentInfo || state.busy} onClick={() => void redo()}><RedoIcon /></ToolButton>
        </div>
        <div className="command-divider" />
        <div className="command-group">
          <ToolButton label="选择" active={state.tool === "select"} onClick={() => selectTool("select")}><SelectIcon /></ToolButton>
          <ToolButton label="抓手" active={state.tool === "hand"} onClick={() => selectTool("hand")}><HandIcon /></ToolButton>
        </div>
        <div className="command-divider" />
        <div className="command-group zoom-controls">
          <button type="button" onClick={() => state.setZoom(state.zoom - 0.1)} disabled={!state.documentInfo} aria-label="缩小">−</button>
          <select
            className="zoom-select"
            value={zoomPresetValue}
            disabled={!state.documentInfo}
            aria-label="缩放比例"
            onChange={(event) => {
              const value = event.target.value;
              if (value === "fit-width") fitZoom && state.setZoom(fitZoom.width);
              else if (value === "fit-page") fitZoom && state.setZoom(fitZoom.page);
              else state.setZoom(Number(value));
            }}
          >
            <option value="fit-width">适合宽度</option>
            <option value="fit-page">适合页面</option>
            <option disabled>────────</option>
            {zoomPresets.map((preset) => <option key={preset} value={preset}>{Math.round(preset * 100)}%</option>)}
            {zoomPresetValue === "custom" && <option value="custom">{Math.round(state.zoom * 100)}%</option>}
          </select>
          <button type="button" onClick={() => state.setZoom(state.zoom + 0.1)} disabled={!state.documentInfo} aria-label="放大">+</button>
          <ToolButton label="顺时针旋转" disabled={!state.documentInfo} onClick={state.rotateClockwise}><RotateIcon /></ToolButton>
        </div>
        <div className="commandbar-spacer" />
        <div className="command-group panel-toggles">
          <ToolButton label="搜索 (Ctrl+F)" disabled={!state.documentInfo} active={searchOpen} onClick={() => { if (searchOpen) closeSearch(); else setSearchOpen(true); }}><SearchIcon /></ToolButton>
          <ToolButton label="显示或隐藏缩略图" text="缩略图" active={state.leftPanelOpen} onClick={state.toggleLeftPanel}><PanelIcon /></ToolButton>
          <ToolButton label="显示或隐藏审读意见" text="审读意见" active={state.commentsOpen} onClick={state.toggleComments}><CommentIcon /></ToolButton>
          <ToolButton label="切换主题" onClick={state.toggleTheme}>{state.theme === "dark" ? <SunIcon /> : <MoonIcon />}</ToolButton>
        </div>
      </div>}

      <div className="app-notices">
        {searchOpen && (
          <div className="searchbar">
            <SearchIcon />
            <input autoFocus value={searchQuery} placeholder="在文档中查找…" onChange={(event) => { searchRequestRef.current += 1; setSearchQuery(event.target.value); setSearchHits([]); setSearchHitIndex(-1); }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); if (searchHits.length) navigateSearch(event.shiftKey ? -1 : 1); else if (!state.busy) void runSearch(); } }} />
            <span>{searchHits.length ? `${searchHitIndex + 1} / ${searchHits.length}` : ""}</span>
            <button type="button" disabled={state.busy} onClick={() => void runSearch()}>查找</button>
            <button type="button" aria-label="上一个搜索结果" disabled={!searchHits.length} onClick={() => navigateSearch(-1)}>↑</button>
            <button type="button" aria-label="下一个搜索结果" disabled={!searchHits.length} onClick={() => navigateSearch(1)}>↓</button>
            <button type="button" aria-label="关闭搜索" onClick={closeSearch}>×</button>
          </div>
        )}

        {state.error && <div className="error-banner" role="alert"><span>{state.error}</span><button type="button" onClick={() => state.setError(null)}>关闭</button></div>}
      </div>

      {pendingPassword && (
        <div className="modal-backdrop" role="presentation">
          <form className="password-dialog" role="dialog" aria-modal="true" aria-labelledby="password-title" onSubmit={(event) => void submitPassword(event)}>
            <div className="password-icon"><img src={appIcon} alt="" /></div>
            <div>
              <h2 id="password-title">此 PDF 受密码保护</h2>
              <p>输入“{pendingPassword.fileName}”的打开密码。密码只在本机内存中交给 MuPDF，不会保存。</p>
            </div>
            <label htmlFor="pdf-password">文档密码</label>
            <input id="pdf-password" autoFocus type="password" value={password} disabled={state.busy} onChange={(event) => { setPassword(event.target.value); setPasswordError(null); }} aria-invalid={Boolean(passwordError)} aria-describedby={passwordError ? "password-error" : undefined} />
            {passwordError && <div className="password-error" id="password-error" role="alert">{passwordError}</div>}
            <div className="dialog-actions">
              <button type="button" onClick={cancelPassword} disabled={state.busy}>取消</button>
              <button className="primary-button" type="submit" disabled={!password || state.busy}>{state.busy ? "正在验证…" : "打开文档"}</button>
            </div>
          </form>
        </div>
      )}

      {commandPaletteOpen && <CommandPalette commands={paletteCommands} onClose={() => setCommandPaletteOpen(false)} />}

      {printPreviewOpen && state.documentInfo && pdfClient && (
        <PrintPreviewDialog
          client={pdfClient}
          documentInfo={state.documentInfo}
          annotations={state.annotations}
          currentPage={state.pageIndex}
          renderScope={`${documentEpoch}:${state.renderRevision}`}
          onClose={() => setPrintPreviewOpen(false)}
        />
      )}

      {!state.documentInfo || !pdfClient ? <EmptyWorkspace onOpen={() => void openDocument()} /> : (
        <div className={`workspace${state.leftPanelOpen ? " has-left" : ""}${state.commentsOpen ? " has-right" : ""}`}>
          {state.leftPanelOpen && (
            <aside className="left-panel">
              <div className="panel-tabs"><button className="is-active" type="button">页面</button><button type="button" disabled>目录</button><button type="button" disabled>附件</button></div>
              <ThumbnailList
                client={pdfClient}
                pages={state.documentInfo.pages}
                activePage={state.pageIndex}
                documentEpoch={documentEpoch}
                renderRevision={state.renderRevision}
                rotation={state.rotation}
                onPageChange={state.setPageIndex}
              />
            </aside>
          )}

          <main className={`document-stage tool-${state.tool}`}>
            <DocumentViewport
              key={documentEpoch}
              client={pdfClient}
              pages={state.documentInfo.pages}
              pageIndex={state.pageIndex}
              scale={state.zoom}
              rotation={state.rotation}
              documentEpoch={documentEpoch}
              renderRevision={state.renderRevision}
              copyAllowed={state.documentInfo.permissions.copy}
              searchHits={searchHits}
              activeSearchHit={searchHitIndex}
              onOpenExternal={(url) => void openExternalLink(url)}
              onPageChange={state.setPageIndex}
              onError={handleRenderError}
              markupTool={isTextMarkupTool(state.tool) ? state.tool : null}
              markupRequest={markupRequest}
              onCreateMarkup={(selection) => void createTextMarkup(selection)}
              placementTool={state.tool === "note" || state.tool === "freeText" ? state.tool : null}
              onPlaceAnnotation={placeAnnotation}
              onViewportSizeChange={state.setViewportSize}
            />
          </main>

          {state.commentsOpen && (
            <aside className="comments-panel" data-annotation-count={state.annotations.length}>
              {pendingAnnotation ? (
                <AnnotationComposer
                  annotation={pendingAnnotation.annotation}
                  selectionText={pendingAnnotation.selectionText}
                  onCancel={() => {
                    setPendingAnnotation(null);
                    state.setTool("select");
                  }}
                  onSubmit={(contents) => void submitPendingAnnotation(contents)}
                />
              ) : selectedAnnotation && annotationDraft && selectedReview ? (() => {
                const annotationLocked = Boolean(selectedAnnotation.flags & (64 | 128 | 512));
                const canEditAnnotation = state.documentInfo.permissions.annotate && !annotationLocked && !state.busy;
                const pageLabel = state.documentInfo.pages[selectedAnnotation.pageIndex]?.label;
                return (
                  <div className="review-detail">
                    <div className="review-detail-topbar">
                      <button
                        ref={reviewDetailBackRef}
                        type="button"
                        onClick={() => {
                          returningReviewIdRef.current = selectedAnnotation.id;
                          setReviewCursorId(selectedAnnotation.id);
                          state.setSelectedAnnotationId(null);
                          setShowRawEditor(false);
                        }}
                      >
                        返回意见列表
                      </button>
                      <span>{selectedReviewIndex + 1} / {visibleAnnotations.length}</span>
                    </div>
                    <header className="review-detail-heading">
                      <div className="review-badges">
                        {selectedReview.isLukeLook && <span className="severity-badge">{selectedReview.severity}</span>}
                        <span className="category-badge">{selectedReview.isLukeLook ? selectedReview.category : annotationKindLabel(selectedAnnotation.kind)}</span>
                      </div>
                      <h2>{selectedReview.isLukeLook ? "审读意见详情" : selectedAnnotation.subject || "普通 PDF 批注"}</h2>
                      <p>PDF 第 {selectedAnnotation.pageIndex + 1} 页{pageLabel && pageLabel !== String(selectedAnnotation.pageIndex + 1) ? ` · 页签 ${pageLabel}` : ""}</p>
                    </header>
                    <div className="review-detail-body">
                      {selectedReview.isLukeLook ? (
                        <>
                          <section><span>问题片段</span><p className="problem-text">{selectedReview.problem || "未提供"}</p></section>
                          <section><span>修改建议</span><p className="suggestion-text">{selectedReview.suggestion || "未提供"}</p></section>
                          {selectedReview.reason && <section><span>依据</span><p>{selectedReview.reason}</p></section>}
                          {selectedReview.hint && <section><span>提示</span><p>{selectedReview.hint}</p></section>}
                          {selectedReview.note && <section><span>说明</span><p>{selectedReview.note}</p></section>}
                        </>
                      ) : (
                        <section><span>{selectedAnnotation.author || "未知作者"}</span><p>{selectedAnnotation.contents || "此批注没有正文。"}</p></section>
                      )}
                      <button className="raw-editor-toggle" type="button" aria-expanded={showRawEditor} onClick={() => setShowRawEditor((value) => !value)}>
                        {showRawEditor
                          ? (selectedReview.isLukeLook ? "收起原始批注属性" : "收起编辑")
                          : (selectedReview.isLukeLook ? "编辑原始批注" : "编辑批注")}
                      </button>
                      {showRawEditor && (
                        <form className="annotation-editor" onSubmit={(event) => void updateSelectedAnnotation(event)}>
                          {annotationLocked && <p className="annotation-lock-notice">此批注已锁定，只能查看。</p>}
                          <label>内容<textarea value={annotationDraft.contents} readOnly={!canEditAnnotation} onChange={(event) => setAnnotationDraft({ ...annotationDraft, contents: event.target.value })} /></label>
                          <div className="annotation-editor-row">
                            <label>作者<input value={annotationDraft.author} readOnly={!canEditAnnotation} onChange={(event) => setAnnotationDraft({ ...annotationDraft, author: event.target.value })} /></label>
                            <label>主题<input value={annotationDraft.subject} readOnly={!canEditAnnotation} onChange={(event) => setAnnotationDraft({ ...annotationDraft, subject: event.target.value })} /></label>
                          </div>
                          <div className="annotation-style-row">
                            <label>颜色<input type="color" value={annotationDraft.color} disabled={!canEditAnnotation} onChange={(event) => setAnnotationDraft({ ...annotationDraft, color: event.target.value })} /></label>
                            <label className="opacity-control">透明度 <span>{Math.round(annotationDraft.opacity * 100)}%</span><input type="range" min="0" max="1" step="0.05" value={annotationDraft.opacity} disabled={!canEditAnnotation} onChange={(event) => setAnnotationDraft({ ...annotationDraft, opacity: Number(event.target.value) })} /></label>
                          </div>
                          <div className="annotation-editor-actions">
                            <button className="danger-button" type="button" disabled={!canEditAnnotation} onClick={() => void deleteSelectedAnnotation()}>删除</button>
                            <button className="primary-button" type="submit" disabled={!canEditAnnotation || !isAnnotationDraftChanged(selectedAnnotation, annotationDraft)}>应用修改</button>
                          </div>
                        </form>
                      )}
                    </div>
                    <div className="review-detail-navigation">
                      <button type="button" title="上一条（↑ / ←）" disabled={selectedReviewIndex <= 0} onClick={() => navigateReview(-1)}>上一条</button>
                      <button type="button" title="下一条（↓ / →）" disabled={selectedReviewIndex < 0 || selectedReviewIndex >= visibleAnnotations.length - 1} onClick={() => navigateReview(1)}>下一条</button>
                    </div>
                  </div>
                );
              })() : (
                <>
                  <div className="panel-heading">
                    <div><span>审读意见</span><small>{annotationsLoading ? "正在读取全文批注…" : `全文 ${state.annotations.length} 条 · 显示 ${visibleAnnotations.length} 条`}</small></div>
                    {workspaceMode === "comment" && <button className="add-annotation-button" type="button" onClick={() => startPlacementTool("note")} disabled={!state.documentInfo.permissions.annotate || state.busy}><NoteIcon />放置便签</button>}
                  </div>
                  <div className="comment-filters" aria-label="审读意见范围">
                    <button className={annotationScope === "all" ? "is-active" : ""} type="button" aria-pressed={annotationScope === "all"} onClick={() => setAnnotationScope("all")}>全文</button>
                    <button className={annotationScope === "page" ? "is-active" : ""} type="button" aria-pressed={annotationScope === "page"} onClick={() => setAnnotationScope("page")}>当前页</button>
                  </div>
                  <div className="comment-controls">
                    <input aria-label="搜索审读意见" value={annotationQuery} placeholder="搜索问题、建议或页码" onChange={(event) => setAnnotationQuery(event.target.value)} />
                    <select aria-label="问题分类" value={reviewCategory} onChange={(event) => setReviewCategory(event.target.value as LukeLookCategoryFilter)}>
                      <option value="all">全部问题</option>
                      {LUKE_LOOK_CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
                    </select>
                  </div>
                  {!annotationsLoading && visibleAnnotations.length === 0 ? (
                    <div className="comment-list" aria-label="文档审读意见">
                      <div className="empty-comments"><NoteIcon /><p>没有匹配的审读意见</p><small>调整范围、分类或搜索条件后重试。</small></div>
                    </div>
                  ) : (
                    <VirtualReviewList
                      annotations={visibleAnnotations}
                      currentPageIndex={state.pageIndex}
                      selectedId={state.selectedAnnotationId}
                      cursorId={reviewCursorId}
                      labelForPage={(pageIndex) => state.documentInfo?.pages[pageIndex]?.label}
                      onSelect={selectReview}
                      registerCard={registerReviewCard}
                    />
                  )}
                </>
              )}
            </aside>
          )}
        </div>
      )}

      <footer className="statusbar">
        <span>{state.documentInfo ? `${state.documentInfo.pageCount} 页` : "准备就绪"}</span>
        <span>{state.documentInfo?.permissions.annotate ? "允许批注" : state.documentInfo ? "只读文档" : ""}</span>
        <div className="statusbar-spacer" />
        {state.documentInfo && (
          <>
            <button type="button" disabled={state.pageIndex === 0} onClick={() => state.setPageIndex(state.pageIndex - 1)} aria-label="上一页">‹</button>
            <input
              className="page-input"
              type="text"
              inputMode="numeric"
              value={pageDraft}
              aria-label="跳转到页码"
              onChange={(event) => setPageDraft(event.target.value.replace(/\D+/gu, ""))}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                const target = Number.parseInt(pageDraft, 10);
                if (Number.isFinite(target)) state.setPageIndex(target - 1);
                event.currentTarget.blur();
              }}
              onBlur={() => setPageDraft(String(state.pageIndex + 1))}
            />
            <span className="page-total">/ {state.documentInfo.pageCount}</span>
            <button type="button" disabled={state.pageIndex >= state.documentInfo.pageCount - 1} onClick={() => state.setPageIndex(state.pageIndex + 1)} aria-label="下一页">›</button>
          </>
        )}
      </footer>
    </div>
  );
}
