import type { AnnotationRecord } from "../pdf/contracts";

export type LukeLookCategory = "错别字" | "标点" | "术语规范" | "格式规范" | "事实核查" | "其他";
export type LukeLookCategoryFilter = LukeLookCategory | "all";

export interface LukeLookReview {
  isLukeLook: boolean;
  severity: string;
  category: LukeLookCategory;
  problem: string;
  suggestion: string;
  reason: string;
  hint: string;
  note: string;
}

const FIELD_LABELS = ["问题片段：", "建议改为：", "依据：", "提示：", "说明："] as const;
const KNOWN_CATEGORIES: readonly Exclude<LukeLookCategory, "其他">[] = [
  "错别字",
  "标点",
  "术语规范",
  "格式规范",
  "事实核查",
];

function fieldValue(source: string, label: (typeof FIELD_LABELS)[number]): string {
  const labelIndex = source.indexOf(label);
  if (labelIndex < 0) return "";
  const valueStart = labelIndex + label.length;
  let valueEnd = source.length;
  for (const nextLabel of FIELD_LABELS) {
    const nextIndex = source.indexOf(nextLabel, valueStart);
    if (nextIndex >= 0 && nextIndex < valueEnd) valueEnd = nextIndex;
  }
  return source.slice(valueStart, valueEnd).trim();
}

function normalizeCategory(raw: string): LukeLookCategory {
  return KNOWN_CATEGORIES.find((category) => raw.includes(category)) ?? "其他";
}

export function parseLukeLookReview(contents: string): LukeLookReview {
  const prefix = /^\s*【\[?([^\]】]+)\]?】\s*(?:\[([^\]]+)\])?\s*([\s\S]*?)(?=问题片段：)/u.exec(contents);
  const problem = fieldValue(contents, "问题片段：");
  const suggestion = fieldValue(contents, "建议改为：");
  const reason = fieldValue(contents, "依据：");
  if (!prefix || !(problem || suggestion || reason)) {
    return {
      isLukeLook: false,
      severity: "",
      category: "其他",
      problem: "",
      suggestion: "",
      reason: "",
      hint: "",
      note: "",
    };
  }

  return {
    isLukeLook: true,
    severity: (prefix[2] || prefix[1]).trim(),
    category: normalizeCategory(prefix[3].trim()),
    problem,
    suggestion,
    reason,
    hint: fieldValue(contents, "提示："),
    note: fieldValue(contents, "说明："),
  };
}

export function filterLukeLookAnnotations(
  annotations: readonly AnnotationRecord[],
  category: LukeLookCategoryFilter,
): AnnotationRecord[] {
  if (category === "all") return [...annotations];
  return annotations.filter((annotation) => {
    const review = parseLukeLookReview(annotation.contents);
    return review.isLukeLook && review.category === category;
  });
}
