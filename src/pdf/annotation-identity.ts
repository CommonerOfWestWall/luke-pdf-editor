import type { AnnotationRecord } from "./contracts";

export interface AnnotationIdentity {
  objectNumber?: number;
  name?: string;
}

export function findAnnotationIndex(
  annotations: readonly AnnotationIdentity[],
  record: Pick<AnnotationRecord, "sourceObjectNumber" | "sourceIndex" | "pdfName">,
): number | undefined {
  if (record.sourceObjectNumber !== undefined) {
    const index = annotations.findIndex(({ objectNumber }) => objectNumber === record.sourceObjectNumber);
    return index >= 0 ? index : undefined;
  }
  if (record.sourceIndex !== undefined) {
    return record.sourceIndex >= 0 && record.sourceIndex < annotations.length
      ? record.sourceIndex
      : undefined;
  }
  if (!record.pdfName) return undefined;
  const index = annotations.findIndex(({ name }) => name === record.pdfName);
  return index >= 0 ? index : undefined;
}

export function createUniqueAnnotationName(
  existingNames: ReadonlySet<string>,
  candidate: () => string,
): string {
  let name: string;
  do name = candidate();
  while (existingNames.has(name));
  return name;
}
