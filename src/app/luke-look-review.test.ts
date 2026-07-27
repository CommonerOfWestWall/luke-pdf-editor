import { describe, expect, it } from "vitest";
import type { AnnotationRecord } from "../pdf/contracts";
import {
  filterLukeLookAnnotations,
  parseLukeLookReview,
  type LukeLookCategory,
} from "./luke-look-review";

function annotation(id: string, contents: string): AnnotationRecord {
  return {
    id,
    pageIndex: 0,
    kind: "highlight",
    rect: [10, 20, 100, 40],
    contents,
    author: "鲁科look AI",
    subject: "审读",
    style: { color: [1, 0.2, 0.2], opacity: 0.35, lineWidth: 1 },
    flags: 4,
  };
}

describe("鲁科 Look 审读批注解析", () => {
  it("extracts the review structure from a real Luke Look annotation", () => {
    const review = parseLukeLookReview(
      "【[硬伤]】[硬伤]错别字 问题片段：洁本 建议改为：节本 "
      + "依据：“洁本”应为“节本”，指删节后的版本。 "
      + "提示：此为常见形近/音近误写，请结合上下文确认。 "
      + "说明：PDF 校样模式仅添加原位高亮和批注，不直接改动正文。",
    );

    expect(review).toEqual({
      isLukeLook: true,
      severity: "硬伤",
      category: "错别字",
      problem: "洁本",
      suggestion: "节本",
      reason: "“洁本”应为“节本”，指删节后的版本。",
      hint: "此为常见形近/音近误写，请结合上下文确认。",
      note: "PDF 校样模式仅添加原位高亮和批注，不直接改动正文。",
    });
  });

  it("handles multiline fields and omitted optional sections", () => {
    const review = parseLukeLookReview(
      "【[建议]】[建议]术语规范\n问题片段：Distributed\n建议改为：distributed\n"
      + "依据：英文书目信息中，\n出版者后的发行说明通常小写。",
    );

    expect(review.isLukeLook).toBe(true);
    expect(review.severity).toBe("建议");
    expect(review.category).toBe("术语规范");
    expect(review.problem).toBe("Distributed");
    expect(review.suggestion).toBe("distributed");
    expect(review.reason).toBe("英文书目信息中，\n出版者后的发行说明通常小写。");
    expect(review.hint).toBe("");
    expect(review.note).toBe("");
  });

  it("falls back safely for ordinary PDF comments", () => {
    expect(parseLukeLookReview("请核对本段数据来源。")).toEqual({
      isLukeLook: false,
      severity: "",
      category: "其他",
      problem: "",
      suggestion: "",
      reason: "",
      hint: "",
      note: "",
    });
  });

  it("normalizes unknown categories without losing the parsed review fields", () => {
    const review = parseLukeLookReview(
      "【[硬伤]】[硬伤]外文拼写 问题片段：Copagni 建议改为：Compagni 依据：缺少字母 m。",
    );

    expect(review.isLukeLook).toBe(true);
    expect(review.category).toBe("其他");
    expect(review.problem).toBe("Copagni");
    expect(review.suggestion).toBe("Compagni");
  });

  it("filters by review category without mutating the source annotations", () => {
    const records = [
      annotation("typo", "【[硬伤]】[硬伤]错别字 问题片段：洁本 建议改为：节本 依据：形近字。"),
      annotation("punctuation", "【[硬伤]】[硬伤]标点 问题片段：《 书名 》 建议改为：《书名》 依据：删除空格。"),
      annotation("unknown", "【[建议]】[建议]外文拼写 问题片段：Copagni 建议改为：Compagni 依据：缺少字母 m。"),
      annotation("generic", "普通人工批注"),
    ];
    const sourceIds = records.map(({ id }) => id);

    expect(filterLukeLookAnnotations(records, "标点").map(({ id }) => id)).toEqual(["punctuation"]);
    expect(filterLukeLookAnnotations(records, "其他").map(({ id }) => id)).toEqual(["unknown"]);
    expect(filterLukeLookAnnotations(records, "all").map(({ id }) => id)).toEqual(sourceIds);
    expect(records.map(({ id }) => id)).toEqual(sourceIds);
  });

  it("exposes a closed category union for stable filter controls", () => {
    const categories: LukeLookCategory[] = ["错别字", "标点", "术语规范", "格式规范", "事实核查", "其他"];
    expect(categories).toHaveLength(6);
  });
});
