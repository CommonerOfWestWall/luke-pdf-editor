import { describe, expect, it } from "vitest";
import { createUniqueAnnotationName, findAnnotationIndex } from "./annotation-identity";

describe("annotation identity", () => {
  it("uses the PDF object number before duplicate names or mutable indexes", () => {
    const annotations = [
      { objectNumber: 41, name: "duplicate" },
      { objectNumber: 72, name: "duplicate" },
    ];

    expect(findAnnotationIndex(annotations, { sourceObjectNumber: 72, sourceIndex: 0, pdfName: "duplicate" })).toBe(1);
  });

  it("finds a stabilized direct annotation after an earlier batch deletion shifts indexes", () => {
    const beforeDeletion = [{ name: "duplicate" }, { name: "luke-stable-2" }];
    expect(findAnnotationIndex(beforeDeletion, { sourceIndex: 1, pdfName: "duplicate" })).toBe(1);

    const afterDeletion = [{ name: "luke-stable-2" }];
    expect(findAnnotationIndex(afterDeletion, { pdfName: "luke-stable-2" })).toBe(0);
  });

  it("rejects a generated name collision", () => {
    const candidates = ["duplicate", "luke-unique"];
    expect(createUniqueAnnotationName(new Set(["duplicate"]), () => candidates.shift()!)).toBe("luke-unique");
  });
});
