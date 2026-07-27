export type PdfPoint = readonly [number, number];
export type PdfRect = readonly [number, number, number, number];
export type PdfQuad = readonly [number, number, number, number, number, number, number, number];
export type AffineMatrix = readonly [number, number, number, number, number, number];

export interface PageCoordinateSpace {
  canonicalToPage: AffineMatrix;
  pdfOrigin: PdfPoint;
}

export type AnnotationKind =
  | "highlight"
  | "underline"
  | "strikeout"
  | "squiggly"
  | "note"
  | "freeText"
  | "ink"
  | "line"
  | "arrow"
  | "rectangle"
  | "ellipse"
  | "polygon"
  | "polyline"
  | "stamp";

export type PdfColor =
  | readonly []
  | readonly [number]
  | readonly [number, number, number]
  | readonly [number, number, number, number];

export interface AnnotationStyle {
  color: PdfColor;
  interiorColor?: PdfColor;
  opacity: number;
  lineWidth: number;
  fontSize?: number;
}

export interface AnnotationRecord {
  id: string;
  pdfName?: string;
  sourceObjectNumber?: number;
  sourceIndex?: number;
  pageIndex: number;
  kind: AnnotationKind;
  rect: PdfRect;
  quadPoints?: readonly PdfQuad[];
  points?: readonly PdfPoint[];
  strokes?: readonly (readonly PdfPoint[])[];
  contents: string;
  author: string;
  subject: string;
  createdAt?: string;
  modifiedAt?: string;
  style: AnnotationStyle;
  flags: number;
  replyTo?: string;
  status?: "none" | "accepted" | "rejected" | "resolved";
}

export type AnnotationCommand =
  | { type: "create"; annotation: AnnotationRecord }
  | { type: "update"; before: AnnotationRecord; after: AnnotationRecord }
  | { type: "delete"; annotation: AnnotationRecord }
  | { type: "batch"; commands: AnnotationCommand[] };

export interface PageInfo {
  index: number;
  /** Crop-relative, unrotated PDF dimensions in points. */
  width: number;
  height: number;
  /** MuPDF page-space dimensions after the page's intrinsic rotation. */
  displayWidth: number;
  displayHeight: number;
  coordinateSpace: PageCoordinateSpace;
  label: string;
}

export interface DocumentInfo {
  title: string;
  pageCount: number;
  pages: PageInfo[];
  needsPassword: boolean;
  permissions: {
    print: boolean;
    copy: boolean;
    edit: boolean;
    annotate: boolean;
  };
}

export interface SearchHit {
  pageIndex: number;
  quads: readonly PdfQuad[];
}

export interface StructuredTextCharacter {
  text: string;
  quad: PdfQuad;
  font: {
    family?: string;
    size: number;
    weight?: string;
    style?: string;
  };
}

export interface StructuredTextSelectionLine {
  characters: StructuredTextCharacter[];
}

export interface ExtractedText {
  text: string;
  lines: StructuredTextSelectionLine[];
}

export interface PdfLink {
  pageIndex: number;
  bounds: PdfRect;
  uri: string;
  external: boolean;
  targetPage?: number;
}

export interface RenderPageRequest {
  pageIndex: number;
  scale: number;
  rotation: 0 | 90 | 180 | 270;
  /** Whether annotation and form appearances are included in the raster. Defaults to true. */
  includeAnnotations?: boolean;
}

export interface RenderedPage {
  pageIndex: number;
  width: number;
  height: number;
  png: Uint8Array;
}

export interface EditState {
  changed: boolean;
  dirty: boolean;
}

export interface ExportedPdf {
  bytes: Uint8Array;
  journalKey: string;
}

export type PdfWorkerMethod =
  | "open"
  | "close"
  | "documentInfo"
  | "renderTile"
  | "extractText"
  | "search"
  | "listLinks"
  | "listAnnotations"
  | "applyCommand"
  | "undo"
  | "redo"
  | "markSaved"
  | "exportPdf";

export interface PdfWorkerRequest<T = unknown> {
  id: number;
  method: PdfWorkerMethod;
  params: T;
}

export type PdfWorkerResponse<T = unknown> =
  | { id: number; ok: true; result: T }
  | { id: number; ok: false; error: string };

export interface PdfWorkerReady {
  type: "ready";
}
