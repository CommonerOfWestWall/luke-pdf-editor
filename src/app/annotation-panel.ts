import type { AnnotationKind, AnnotationRecord, PdfColor } from "../pdf/contracts";

export type AnnotationScope = "all" | "page";

export interface AnnotationFilters {
  scope: AnnotationScope;
  pageIndex: number;
  kind: AnnotationKind | "all";
  query: string;
}

export interface AnnotationDraft {
  contents: string;
  author: string;
  subject: string;
  color: string;
  opacity: number;
}

const KIND_LABELS: Record<AnnotationKind, string> = {
  highlight: "高亮",
  underline: "下划线",
  strikeout: "删除线",
  squiggly: "波浪线",
  note: "便签",
  freeText: "自由文本",
  ink: "墨迹",
  line: "直线",
  arrow: "箭头",
  rectangle: "矩形",
  ellipse: "椭圆",
  polygon: "多边形",
  polyline: "折线",
  stamp: "印章",
};

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

function channelToHex(value: number): string {
  return Math.round(clampUnit(value) * 255).toString(16).padStart(2, "0");
}

function colorToRgb(color: PdfColor): readonly [number, number, number] {
  if (color.length === 1) return [color[0], color[0], color[0]];
  if (color.length === 3) return color;
  if (color.length === 4) {
    const [cyan, magenta, yellow, black] = color;
    return [
      (1 - cyan) * (1 - black),
      (1 - magenta) * (1 - black),
      (1 - yellow) * (1 - black),
    ];
  }
  return [244 / 255, 191 / 255, 54 / 255];
}

export function annotationKindLabel(kind: AnnotationKind): string {
  return KIND_LABELS[kind];
}

export function annotationColorToHex(color: PdfColor): string {
  return `#${colorToRgb(color).map(channelToHex).join("")}`;
}

export function hexToAnnotationColor(value: string): readonly [number, number, number] {
  const match = /^#([0-9a-f]{6})$/i.exec(value);
  if (!match) throw new Error("批注颜色必须是六位十六进制颜色");
  return [0, 2, 4].map((offset) => Number.parseInt(match[1].slice(offset, offset + 2), 16) / 255) as unknown as readonly [number, number, number];
}

export function annotationToDraft(annotation: AnnotationRecord): AnnotationDraft {
  return {
    contents: annotation.contents,
    author: annotation.author,
    subject: annotation.subject,
    color: annotationColorToHex(annotation.style.color),
    opacity: annotation.style.opacity,
  };
}

export function createAnnotationUpdate(
  before: AnnotationRecord,
  draft: AnnotationDraft,
  modifiedAt = new Date().toISOString(),
): AnnotationRecord {
  const currentColor = annotationColorToHex(before.style.color);
  return {
    ...before,
    contents: draft.contents,
    author: draft.author,
    subject: draft.subject,
    modifiedAt,
    style: {
      ...before.style,
      color: draft.color.toLowerCase() === currentColor ? before.style.color : hexToAnnotationColor(draft.color),
      opacity: clampUnit(draft.opacity),
    },
  };
}

export function isAnnotationDraftChanged(annotation: AnnotationRecord, draft: AnnotationDraft): boolean {
  const current = annotationToDraft(annotation);
  return current.contents !== draft.contents
    || current.author !== draft.author
    || current.subject !== draft.subject
    || current.color !== draft.color.toLowerCase()
    || Math.abs(current.opacity - clampUnit(draft.opacity)) > 0.0001;
}

export function findCreatedAnnotation(
  before: readonly AnnotationRecord[],
  after: readonly AnnotationRecord[],
  requested: AnnotationRecord,
): AnnotationRecord | null {
  const sameId = after.find(({ id }) => id === requested.id);
  if (sameId) return sameId;
  const previousIds = new Set(before.map(({ id }) => id));
  const candidates = after.filter((annotation) => (
    !previousIds.has(annotation.id)
    && annotation.pageIndex === requested.pageIndex
    && annotation.kind === requested.kind
  ));
  return candidates.toSorted((left, right) => {
    const distance = (annotation: AnnotationRecord) => annotation.rect.reduce(
      (total, value, index) => total + Math.abs(value - requested.rect[index]),
      0,
    );
    return distance(left) - distance(right);
  })[0] ?? null;
}

export function filterAndSortAnnotations(
  annotations: readonly AnnotationRecord[],
  filters: AnnotationFilters,
): AnnotationRecord[] {
  const terms = filters.query.trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean);
  return annotations
    .filter((annotation) => filters.scope === "all" || annotation.pageIndex === filters.pageIndex)
    .filter((annotation) => filters.kind === "all" || annotation.kind === filters.kind)
    .filter((annotation) => {
      if (!terms.length) return true;
      const searchable = [
        annotation.author,
        annotation.contents,
        annotation.subject,
        annotationKindLabel(annotation.kind),
        String(annotation.pageIndex + 1),
      ].join(" ").toLocaleLowerCase();
      return terms.every((term) => searchable.includes(term));
    })
    .toSorted((left, right) => left.pageIndex - right.pageIndex
      || right.rect[3] - left.rect[3]
      || left.rect[0] - right.rect[0]
      || left.id.localeCompare(right.id));
}

export interface AnnotationPageGroup {
  pageIndex: number;
  label: string;
  count: number;
  annotations: AnnotationRecord[];
}

/**
 * 把已排序的批注列表折叠成按页分组（PDF-XChange Comments 面板的组织方式）。
 * 输入保持原顺序；label 缺省回退为页码数字。
 */
export function groupAnnotationsByPage(
  annotations: readonly AnnotationRecord[],
  labelForPage: (pageIndex: number) => string | undefined,
): AnnotationPageGroup[] {
  const groups: AnnotationPageGroup[] = [];
  let current: AnnotationPageGroup | null = null;
  for (const annotation of annotations) {
    if (!current || current.pageIndex !== annotation.pageIndex) {
      current = {
        pageIndex: annotation.pageIndex,
        label: labelForPage(annotation.pageIndex) ?? String(annotation.pageIndex + 1),
        count: 0,
        annotations: [],
      };
      groups.push(current);
    }
    current.annotations.push(annotation);
    current.count += 1;
  }
  return groups;
}
