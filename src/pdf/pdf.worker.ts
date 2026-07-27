/// <reference lib="webworker" />

import mupdf, {
  ColorSpace,
  Document,
  Matrix,
  type PDFAnnotation,
  type PDFAnnotationType,
  type PDFDocument,
  type PDFPage,
  type Quad,
  type Rect,
} from "mupdf";
import type {
  AnnotationCommand,
  AnnotationKind,
  AnnotationRecord,
  DocumentInfo,
  EditState,
  ExtractedText,
  PageCoordinateSpace,
  PdfPoint,
  PdfQuad,
  PdfLink,
  ExportedPdf,
  PdfWorkerReady,
  PdfWorkerRequest,
  PdfWorkerResponse,
  RenderPageRequest,
  RenderedPage,
  SearchHit,
} from "./contracts";
import { isJournalDirty, journalKey } from "./journal-state";
import { createUniqueAnnotationName, findAnnotationIndex } from "./annotation-identity";
import { assertAnnotationCreatable, configureAnnotation, updateAnnotation } from "./annotation-write";
import { assertAnnotationUpdateAllowed, isAnnotationLocked } from "./annotation-update-policy";
import {
  derivePageCoordinateSpace,
  pagePointToPdf,
  pageRectToPdf,
} from "./coordinates";

let document: PDFDocument | null = null;
let documentInfo: DocumentInfo | null = null;
let savedJournalKey = "root";
let journalOperationId = 0;

function currentJournalKey(doc = requireDocument()): string {
  return journalKey(doc.getJournal());
}

function editState(changed: boolean): EditState {
  return { changed, dirty: isJournalDirty(requireDocument().getJournal(), savedJournalKey) };
}

const TYPE_BY_KIND: Record<AnnotationKind, PDFAnnotationType> = {
  highlight: "Highlight",
  underline: "Underline",
  strikeout: "StrikeOut",
  squiggly: "Squiggly",
  note: "Text",
  freeText: "FreeText",
  ink: "Ink",
  line: "Line",
  arrow: "Line",
  rectangle: "Square",
  ellipse: "Circle",
  polygon: "Polygon",
  polyline: "PolyLine",
  stamp: "Stamp",
};

function requireDocument(): PDFDocument {
  if (!document) throw new Error("没有打开的 PDF 文档");
  return document;
}

function isoDate(read: () => Date): string | undefined {
  try {
    const date = read();
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  } catch {
    return undefined;
  }
}

function hasDictionaryValue(object: ReturnType<PDFAnnotation["getObject"]>, key: string): boolean {
  const value = object.get(key);
  try {
    return !value.isNull();
  } finally {
    value.destroy();
  }
}

function kindFromAnnotation(annotation: PDFAnnotation): AnnotationKind | null {
  const type = annotation.getType();
  if (type === "Line") {
    const endings = annotation.getLineEndingStyles();
    return endings.end !== "None" ? "arrow" : "line";
  }

  const mapping: Partial<Record<PDFAnnotationType, AnnotationKind>> = {
    Highlight: "highlight",
    Underline: "underline",
    StrikeOut: "strikeout",
    Squiggly: "squiggly",
    Text: "note",
    FreeText: "freeText",
    Ink: "ink",
    Square: "rectangle",
    Circle: "ellipse",
    Polygon: "polygon",
    PolyLine: "polyline",
    Stamp: "stamp",
  };
  return mapping[type] ?? null;
}

function transformQuad(quad: Quad, transform: (point: PdfPoint) => PdfPoint): Quad {
  const result = [...quad] as Quad;
  for (let index = 0; index < result.length; index += 2) {
    const point = transform([result[index], result[index + 1]]);
    result[index] = point[0];
    result[index + 1] = point[1];
  }
  return result;
}

function pageGeometry(page: PDFPage) {
  const bounds = page.getBounds() as Rect;
  const derived = derivePageCoordinateSpace(bounds, page.getTransform());
  return {
    ...derived,
    displayWidth: bounds[2] - bounds[0],
    displayHeight: bounds[3] - bounds[1],
  };
}

function annotationToRecord(
  annotation: PDFAnnotation,
  pageIndex: number,
  fallbackIndex: number,
  coordinateSpace: PageCoordinateSpace,
): AnnotationRecord | null {
  const kind = kindFromAnnotation(annotation);
  if (!kind) return null;

  const name = annotation.getName();
  const object = annotation.getObject();
  const sourceObjectNumber = object.isIndirect() ? object.asIndirect() : undefined;
  const hasCreationDate = hasDictionaryValue(object, "CreationDate");
  const hasModificationDate = hasDictionaryValue(object, "M");
  object.destroy();
  return {
    id: sourceObjectNumber !== undefined
      ? `pdf-object-${pageIndex}-${sourceObjectNumber}`
      : `pdf-direct-${pageIndex}-${fallbackIndex}`,
    pdfName: name || undefined,
    sourceObjectNumber,
    sourceIndex: fallbackIndex,
    pageIndex,
    kind,
    rect: pageRectToPdf(
      (annotation.hasRect() ? annotation.getRect() : annotation.getBounds()) as Rect,
      coordinateSpace,
    ),
    quadPoints: annotation.hasQuadPoints()
      ? annotation.getQuadPoints().map((quad) => transformQuad(quad, (point) => pagePointToPdf(point, coordinateSpace)))
      : undefined,
    points:
      annotation.hasVertices()
        ? annotation.getVertices().map((point) => pagePointToPdf(point, coordinateSpace))
        : annotation.hasLine()
          ? annotation.getLine().map((point) => pagePointToPdf(point, coordinateSpace))
          : undefined,
    strokes: annotation.hasInkList()
      ? annotation.getInkList().map((stroke) => stroke.map((point) => pagePointToPdf(point, coordinateSpace)))
      : undefined,
    contents: annotation.getContents(),
    author: annotation.hasAuthor() ? annotation.getAuthor() : "",
    subject: annotation.hasSubject() ? annotation.getSubject() : "",
    createdAt: hasCreationDate ? isoDate(() => annotation.getCreationDate()) : undefined,
    modifiedAt: hasModificationDate ? isoDate(() => annotation.getModificationDate()) : undefined,
    style: {
      color: annotation.getColor(),
      interiorColor: annotation.hasInteriorColor() ? annotation.getInteriorColor() : undefined,
      opacity: annotation.getOpacity(),
      lineWidth: annotation.hasBorder() ? annotation.getBorderWidth() : 1,
      fontSize: annotation.getType() === "FreeText" ? annotation.getDefaultAppearance().size : undefined,
    },
    flags: annotation.getFlags(),
  };
}

function listPageAnnotations(pageIndex: number): AnnotationRecord[] {
  const page = requireDocument().loadPage(pageIndex);
  try {
    const { space } = pageGeometry(page);
    const annotations = page.getAnnotations();
    try {
      return annotations
        .map((annotation, index) => annotationToRecord(annotation, pageIndex, index, space))
        .filter((annotation): annotation is AnnotationRecord => annotation !== null);
    } finally {
      annotations.forEach((annotation) => annotation.destroy());
    }
  } finally {
    page.destroy();
  }
}

function findAnnotation(page: PDFPage, record: AnnotationRecord): {
  annotation: PDFAnnotation | undefined;
  annotations: PDFAnnotation[];
} {
  const annotations = page.getAnnotations();
  try {
    const index = findAnnotationIndex(
      annotations.map((annotation) => {
        const object = annotation.getObject();
        try {
          return {
            objectNumber: object.isIndirect() ? object.asIndirect() : undefined,
            name: annotation.getName() || undefined,
          };
        } finally {
          object.destroy();
        }
      }),
      record,
    );
    return { annotation: index === undefined ? undefined : annotations[index], annotations };
  } catch (error) {
    annotations.forEach((annotation) => annotation.destroy());
    throw error;
  }
}

function stabilizeBatchTargets(command: AnnotationCommand): AnnotationCommand {
  const contexts = new Map<number, {
    page: PDFPage;
    annotations: PDFAnnotation[];
    names: Set<string>;
    stableNames: Map<number, string>;
  }>();

  const stabilize = (record: AnnotationRecord): AnnotationRecord => {
    if (record.sourceObjectNumber !== undefined || record.sourceIndex === undefined) return record;
    let context = contexts.get(record.pageIndex);
    if (!context) {
      const page = requireDocument().loadPage(record.pageIndex);
      const annotations = page.getAnnotations();
      try {
        context = {
          page,
          annotations,
          names: new Set(annotations.map((annotation) => annotation.getName()).filter(Boolean)),
          stableNames: new Map(),
        };
        contexts.set(record.pageIndex, context);
      } catch (error) {
        annotations.forEach((annotation) => annotation.destroy());
        page.destroy();
        throw error;
      }
    }
    const annotation = context.annotations[record.sourceIndex];
    if (!annotation) throw new Error(`找不到批注：${record.id}`);
    let stableName = context.stableNames.get(record.sourceIndex);
    if (!stableName) {
      stableName = createUniqueAnnotationName(context.names, () => `luke-${crypto.randomUUID()}`);
      context.names.add(stableName);
      context.stableNames.set(record.sourceIndex, stableName);
      annotation.setName(stableName);
      annotation.update();
    }
    return { ...record, pdfName: stableName, sourceIndex: undefined };
  };

  const transform = (value: AnnotationCommand): AnnotationCommand => {
    if (value.type === "batch") return { type: "batch", commands: value.commands.map(transform) };
    if (value.type === "update") {
      return { type: "update", before: stabilize(value.before), after: stabilize(value.after) };
    }
    return { type: value.type, annotation: stabilize(value.annotation) };
  };

  try {
    return transform(command);
  } finally {
    let cleanupError: unknown;
    const cleanup = (action: () => void) => {
      try {
        action();
      } catch (error) {
        cleanupError ??= error;
      }
    };
    for (const context of contexts.values()) {
      cleanup(() => context.page.update());
      context.annotations.forEach((annotation) => cleanup(() => annotation.destroy()));
      cleanup(() => context.page.destroy());
    }
    if (cleanupError) throw cleanupError;
  }
}

function assertDocumentCanAnnotate(): void {
  if (!requireDocument().hasPermission(Document.PERMISSION_ANNOTATE)) {
    throw new Error("此 PDF 的权限不允许修改批注");
  }
}

function applySingleCommand(command: Exclude<AnnotationCommand, { type: "batch" }>): void {
  const doc = requireDocument();
  assertDocumentCanAnnotate();
  const record = command.type === "update" ? command.after : command.annotation;
  const page = doc.loadPage(record.pageIndex);

  try {
    const { space } = pageGeometry(page);
    if (command.type === "create") {
      assertAnnotationCreatable(record);
      const annotation = page.createAnnotation(TYPE_BY_KIND[record.kind]);
      try {
        configureAnnotation(annotation, record, true, space);
      } finally {
        annotation.destroy();
      }
    } else if (command.type === "update") {
      assertAnnotationUpdateAllowed(command.before, command.after);
      const found = findAnnotation(page, command.before);
      try {
        if (!found.annotation) throw new Error(`找不到批注：${command.before.id}`);
        if (isAnnotationLocked(found.annotation.getFlags())) throw new Error("此批注已锁定，不能修改");
        updateAnnotation(found.annotation, record);
      } finally {
        found.annotations.forEach((annotation) => annotation.destroy());
      }
    } else {
      const found = findAnnotation(page, record);
      try {
        if (!found.annotation) throw new Error(`找不到批注：${record.id}`);
        if (isAnnotationLocked(found.annotation.getFlags())) throw new Error("此批注已锁定，不能删除");
        page.deleteAnnotation(found.annotation);
      } finally {
        found.annotations.forEach((annotation) => annotation.destroy());
      }
    }
    page.update();
  } finally {
    page.destroy();
  }
}

function applyCommand(command: AnnotationCommand): void {
  const doc = requireDocument();
  journalOperationId += 1;
  doc.beginOperation(`annotation:${command.type}:${journalOperationId}`);
  try {
    const stableCommand = command.type === "batch" ? stabilizeBatchTargets(command) : command;
    if (stableCommand.type === "batch") {
      for (const child of stableCommand.commands) applyCommandWithoutJournal(child);
    } else {
      applySingleCommand(stableCommand);
    }
    doc.endOperation();
  } catch (error) {
    doc.abandonOperation();
    throw error;
  }
}

function applyCommandWithoutJournal(command: AnnotationCommand): void {
  if (command.type === "batch") {
    for (const child of command.commands) applyCommandWithoutJournal(child);
  } else {
    applySingleCommand(command);
  }
}

function buildDocumentInfo(doc: PDFDocument): DocumentInfo {
  const pageCount = doc.countPages();
  const pages = Array.from({ length: pageCount }, (_, index) => {
    const page = doc.loadPage(index);
    try {
      const geometry = pageGeometry(page);
      return {
        index,
        width: geometry.width,
        height: geometry.height,
        displayWidth: geometry.displayWidth,
        displayHeight: geometry.displayHeight,
        coordinateSpace: geometry.space,
        label: page.getLabel() || String(index + 1),
      };
    } finally {
      page.destroy();
    }
  });

  return {
    title: doc.getMetaData(Document.META_INFO_TITLE) ?? "",
    pageCount,
    pages,
    needsPassword: false,
    permissions: {
      print: doc.hasPermission(Document.PERMISSION_PRINT),
      copy: doc.hasPermission(Document.PERMISSION_COPY),
      // MuPDF.js 1.28.0 exports PERMISSION_EDIT as the invalid string "eedit".
      // The public DocumentPermission type and runtime permission table both use "edit".
      edit: doc.hasPermission("edit"),
      annotate: doc.hasPermission(Document.PERMISSION_ANNOTATE),
    },
  };
}

async function handleRequest(request: PdfWorkerRequest): Promise<unknown> {
  switch (request.method) {
    case "open": {
      const { bytes, password } = request.params as { bytes: Uint8Array; password?: string };
      const opened = mupdf.Document.openDocument(bytes, "application/pdf");
      const pdf = opened.asPDF();
      if (!pdf) {
        opened.destroy();
        throw new Error("所选文件不是 PDF 文档");
      }
      if (pdf.needsPassword() && (!password || pdf.authenticatePassword(password) === 0)) {
        pdf.destroy();
        throw new Error("PASSWORD_REQUIRED");
      }
      pdf.disableJS();
      pdf.enableJournal();
      try {
        const nextDocumentInfo = buildDocumentInfo(pdf);
        const previousDocument = document;
        document = pdf;
        documentInfo = nextDocumentInfo;
        savedJournalKey = "root";
        previousDocument?.destroy();
        return nextDocumentInfo;
      } catch (error) {
        pdf.destroy();
        throw error;
      }
    }
    case "close":
      document?.destroy();
      document = null;
      documentInfo = null;
      savedJournalKey = "root";
      return null;
    case "documentInfo":
      return documentInfo ?? buildDocumentInfo(requireDocument());
    case "renderTile": {
      const { pageIndex, scale, rotation, includeAnnotations = true } = request.params as RenderPageRequest;
      const page = requireDocument().loadPage(pageIndex);
      try {
        const matrix = Matrix.concat(Matrix.rotate(rotation), Matrix.scale(scale, scale));
        const pixmap = page.toPixmap(matrix, ColorSpace.DeviceRGB, false, includeAnnotations);
        try {
          const png = new Uint8Array(pixmap.asPNG());
          const result: RenderedPage = {
            pageIndex,
            width: pixmap.getWidth(),
            height: pixmap.getHeight(),
            png,
          };
          return result;
        } finally {
          pixmap.destroy();
        }
      } finally {
        page.destroy();
      }
    }
    case "extractText": {
      const { pageIndex } = request.params as { pageIndex: number };
      const page = requireDocument().loadPage(pageIndex);
      try {
        const text = page.toStructuredText("preserve-whitespace");
        try {
          const lines: ExtractedText["lines"] = [];
          let currentLine: ExtractedText["lines"][number] | null = null;
          text.walk({
            beginLine: () => {
              currentLine = { characters: [] };
              lines.push(currentLine);
            },
            onChar: (character, _origin, font, size, quad) => {
              if (!currentLine) {
                currentLine = { characters: [] };
                lines.push(currentLine);
              }
              currentLine.characters.push({
                text: character,
                quad: [...quad] as PdfQuad,
                font: {
                  family: font.getName(),
                  size,
                  weight: font.isBold() ? "bold" : "normal",
                  style: font.isItalic() ? "italic" : "normal",
                },
              });
            },
            endLine: () => {
              currentLine = null;
            },
          });
          const result: ExtractedText = {
            text: text.asText(),
            lines,
          };
          return result;
        } finally {
          text.destroy();
        }
      } finally {
        page.destroy();
      }
    }
    case "search": {
      const { query } = request.params as { query: string };
      const doc = requireDocument();
      const hits: SearchHit[] = [];
      for (let pageIndex = 0; pageIndex < doc.countPages(); pageIndex += 1) {
        const page = doc.loadPage(pageIndex);
        try {
          const { space } = pageGeometry(page);
          for (const quads of page.search(query, 256)) {
            hits.push({
              pageIndex,
              quads: quads.map((quad) => transformQuad(quad, (point) => pagePointToPdf(point, space))),
            });
          }
        } finally {
          page.destroy();
        }
      }
      return hits;
    }
    case "listLinks": {
      const { pageIndex } = request.params as { pageIndex: number };
      const doc = requireDocument();
      const page = doc.loadPage(pageIndex);
      try {
        const { space } = pageGeometry(page);
        const links = page.getLinks();
        try {
          return links.map((link): PdfLink => {
            const uri = link.getURI();
            const external = link.isExternal();
            let targetPage: number | undefined;
            if (!external) {
              try {
                const resolved = doc.resolveLink(uri);
                if (resolved >= 0 && resolved < doc.countPages()) targetPage = resolved;
              } catch {
                targetPage = undefined;
              }
            }
            return {
              pageIndex,
              bounds: pageRectToPdf(link.getBounds(), space),
              uri,
              external,
              targetPage,
            };
          });
        } finally {
          links.forEach((link) => link.destroy());
        }
      } finally {
        page.destroy();
      }
    }
    case "listAnnotations": {
      const { pageIndex } = request.params as { pageIndex: number };
      return listPageAnnotations(pageIndex);
    }
    case "applyCommand":
      applyCommand((request.params as { command: AnnotationCommand }).command);
      return editState(true);
    case "undo":
      if (!requireDocument().canUndo()) return editState(false);
      requireDocument().undo();
      return editState(true);
    case "redo":
      if (!requireDocument().canRedo()) return editState(false);
      requireDocument().redo();
      return editState(true);
    case "markSaved":
      savedJournalKey = (request.params as { journalKey: string }).journalKey;
      return editState(false);
    case "exportPdf": {
      const buffer = requireDocument().saveToBuffer("garbage=1,compress=yes,compress-images=yes");
      try {
        const result: ExportedPdf = {
          bytes: new Uint8Array(buffer.asUint8Array()),
          journalKey: currentJournalKey(),
        };
        return result;
      } finally {
        buffer.destroy();
      }
    }
  }
}

self.onmessage = async (event: MessageEvent<PdfWorkerRequest>) => {
  const request = event.data;
  try {
    const result = await handleRequest(request);
    const response: PdfWorkerResponse = { id: request.id, ok: true, result };
    const transfer: Transferable[] = [];
    if (result instanceof Uint8Array) transfer.push(result.buffer as ArrayBuffer);
    if (typeof result === "object" && result && "bytes" in result) {
      transfer.push((result as ExportedPdf).bytes.buffer as ArrayBuffer);
    }
    if (typeof result === "object" && result && "png" in result) {
      transfer.push((result as RenderedPage).png.buffer as ArrayBuffer);
    }
    self.postMessage(response, { transfer });
  } catch (error) {
    const response: PdfWorkerResponse = {
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
    self.postMessage(response);
  }
};

self.postMessage({ type: "ready" } satisfies PdfWorkerReady);
