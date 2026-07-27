import type { AnnotationRecord } from "./contracts";

export const READ_ONLY_ANNOTATION_FLAGS = 64 | 128 | 512;

export function isAnnotationLocked(flags: number): boolean {
  return (flags & READ_ONLY_ANNOTATION_FLAGS) !== 0;
}

function immutableAnnotationFields(annotation: AnnotationRecord): unknown {
  return {
    id: annotation.id,
    pdfName: annotation.pdfName,
    sourceObjectNumber: annotation.sourceObjectNumber,
    sourceIndex: annotation.sourceIndex,
    pageIndex: annotation.pageIndex,
    kind: annotation.kind,
    rect: annotation.rect,
    quadPoints: annotation.quadPoints,
    points: annotation.points,
    strokes: annotation.strokes,
    createdAt: annotation.createdAt,
    flags: annotation.flags,
    replyTo: annotation.replyTo,
    status: annotation.status,
    style: {
      interiorColor: annotation.style.interiorColor,
      lineWidth: annotation.style.lineWidth,
      fontSize: annotation.style.fontSize,
    },
  };
}

export function assertAnnotationUpdateAllowed(before: AnnotationRecord, after: AnnotationRecord): void {
  if (JSON.stringify(immutableAnnotationFields(before)) !== JSON.stringify(immutableAnnotationFields(after))) {
    throw new Error("批注更新包含不允许修改的身份、几何、标志或样式字段");
  }
}
