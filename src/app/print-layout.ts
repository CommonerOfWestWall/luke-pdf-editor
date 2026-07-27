import type { AnnotationRecord } from "../pdf/contracts";

export interface PrintCommentPlacement {
  annotation: AnnotationRecord;
  anchorY: number;
  top: number;
  height: number;
}

export function parsePageRange(value: string, pageCount: number): number[] {
  const indexes = new Set<number>();
  for (const part of value.split(",")) {
    const token = part.trim();
    if (!token) continue;
    const match = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(token);
    if (!match) throw new Error(`无法识别页码“${token}”`);
    const start = Number(match[1]);
    const end = Number(match[2] ?? match[1]);
    if (start < 1 || end < start || end > pageCount) {
      throw new Error(`页码必须在 1–${pageCount} 之间`);
    }
    for (let page = start; page <= end; page += 1) indexes.add(page - 1);
  }
  const result = [...indexes].sort((a, b) => a - b);
  if (!result.length) throw new Error("请至少输入一个页码");
  return result;
}

export function layoutPrintComments(
  annotations: readonly AnnotationRecord[],
  pageHeight: number,
  options: { padding?: number; gap?: number; minHeight?: number } = {},
): PrintCommentPlacement[] {
  const padding = options.padding ?? 16;
  const preferredGap = options.gap ?? 8;
  const minHeight = options.minHeight ?? 44;
  const comments = annotations
    .filter(({ contents }) => contents.trim())
    .map((annotation) => ({
      annotation,
      anchorY: pageHeight - (annotation.rect[1] + annotation.rect[3]) / 2,
      height: Math.max(minHeight, Math.min(92, 30 + annotation.contents.trim().length * 1.2)),
    }))
    .sort((a, b) => a.anchorY - b.anchorY);

  if (!comments.length) return [];

  const availableHeight = Math.max(0, pageHeight - padding * 2);
  const compactHeight = Math.min(18, availableHeight / comments.length);
  const gap = comments.length > 1
    ? Math.max(
        0,
        Math.min(
          preferredGap,
          (availableHeight - compactHeight * comments.length) / (comments.length - 1),
        ),
      )
    : 0;
  const availableBarHeight = Math.max(0, availableHeight - gap * (comments.length - 1));
  const desiredExtraHeight = comments.reduce(
    (total, comment) => total + Math.max(0, comment.height - compactHeight),
    0,
  );
  const extraScale = desiredExtraHeight > 0
    ? Math.min(
        1,
        Math.max(0, availableBarHeight - compactHeight * comments.length) / desiredExtraHeight,
      )
    : 0;
  comments.forEach((comment) => {
    comment.height = compactHeight + Math.max(0, comment.height - compactHeight) * extraScale;
  });

  const placed = comments.map((comment, index) => ({
    ...comment,
    top: Math.max(
      padding,
      comment.anchorY - comment.height / 2,
      index ? 0 : padding,
    ),
  }));
  for (let index = 1; index < placed.length; index += 1) {
    placed[index].top = Math.max(
      placed[index].top,
      placed[index - 1].top + placed[index - 1].height + gap,
    );
  }
  if (!placed.length) return placed;
  const overflow = placed.at(-1)!.top + placed.at(-1)!.height + padding - pageHeight;
  if (overflow > 0) {
    placed[placed.length - 1].top -= overflow;
    for (let index = placed.length - 2; index >= 0; index -= 1) {
      placed[index].top = Math.min(
        placed[index].top,
        placed[index + 1].top - gap - placed[index].height,
      );
    }
    if (placed[0].top < padding && availableHeight > 0) {
      const shift = padding - placed[0].top;
      placed.forEach((item) => { item.top += shift; });
    }
  }
  return placed;
}
