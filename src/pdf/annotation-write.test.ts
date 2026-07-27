import { describe, expect, it } from "vitest";
import mupdf, { type PDFAnnotation, type PDFDocument, type PDFPage } from "mupdf";
import type { AnnotationRecord, PageCoordinateSpace, PdfRect } from "./contracts";
import { derivePageCoordinateSpace, pagePointToPdf } from "./coordinates";
import { assertAnnotationCreatable, configureAnnotation } from "./annotation-write";

function blankDocument(): { doc: PDFDocument; page: PDFPage; space: PageCoordinateSpace } {
  const doc = new mupdf.PDFDocument();
  doc.insertPage(0, doc.addPage([0, 0, 612, 792], 0, {}, ""));
  const page = doc.loadPage(0);
  const { space } = derivePageCoordinateSpace(page.getBounds(), page.getTransform());
  return { doc, page, space };
}

function markupRecord(rect: PdfRect, overrides: Partial<AnnotationRecord> = {}): AnnotationRecord {
  return {
    id: "record-1",
    pageIndex: 0,
    kind: "highlight",
    rect,
    contents: "测试批注",
    author: "鲁科用户",
    subject: "高亮",
    createdAt: "2026-07-23T00:00:00.000Z",
    modifiedAt: "2026-07-23T00:00:00.000Z",
    style: { color: [1, 0.85, 0.2], opacity: 0.5, lineWidth: 1 },
    flags: 4,
    ...overrides,
  };
}

function dictRect(annotation: PDFAnnotation): number[] | null {
  const object = annotation.getObject();
  try {
    const rect = object.get("Rect");
    try {
      if (rect.isNull()) return null;
      return Array.from({ length: 4 }, (_, index) => rect.get(index).asNumber());
    } finally {
      rect.destroy();
    }
  } finally {
    object.destroy();
  }
}

function savePdf(doc: PDFDocument): Uint8Array {
  const buffer = doc.saveToBuffer("garbage=1");
  try {
    return new Uint8Array(buffer.asUint8Array());
  } finally {
    buffer.destroy();
  }
}

describe("assertAnnotationCreatable", () => {
  it("rejects geometry-less markup instead of producing a corrupted Rect", () => {
    expect(() => assertAnnotationCreatable(markupRecord([0, 0, 10, 10]))).toThrow(/QuadPoints/);
    expect(() => assertAnnotationCreatable(markupRecord([0, 0, 10, 10], { kind: "ink" }))).toThrow(/墨迹/);
    expect(() => assertAnnotationCreatable(markupRecord([0, 0, 10, 10], { kind: "line", points: [[1, 1]] }))).toThrow(/端点/);
    expect(() => assertAnnotationCreatable(markupRecord([0, 0, 10, 10], { kind: "polygon", points: [[1, 1], [2, 2]] }))).toThrow(/顶点/);
  });

  it("accepts records carrying the geometry their kind requires", () => {
    expect(() => assertAnnotationCreatable(markupRecord([0, 0, 10, 10], {
      quadPoints: [[0, 10, 10, 10, 0, 0, 10, 0]],
    }))).not.toThrow();
    expect(() => assertAnnotationCreatable(markupRecord([0, 0, 10, 10], { kind: "note" }))).not.toThrow();
    expect(() => assertAnnotationCreatable(markupRecord([0, 0, 10, 10], { kind: "ink", strokes: [[[0, 0], [5, 5]]] }))).not.toThrow();
  });
});

describe("configureAnnotation", () => {
  it("round-trips canonical QuadPoints on a rotated page with an offset CropBox", () => {
    const doc = new mupdf.PDFDocument();
    const pageObject = doc.addPage([0, 0, 612, 792], 90, {}, "");
    pageObject.put("CropBox", [40, 80, 540, 680]);
    doc.insertPage(0, pageObject);
    pageObject.destroy();
    const page = doc.loadPage(0);
    const derived = derivePageCoordinateSpace(page.getBounds(), page.getTransform());
    const expectedQuad = [22, 58, 180, 58, 22, 36, 180, 36] as const;
    let saved: Uint8Array;

    try {
      expect(derived.space.pdfOrigin).toEqual([40, 80]);
      expect(derived.width).toBeCloseTo(500, 6);
      expect(derived.height).toBeCloseTo(600, 6);

      const annotation = page.createAnnotation("Highlight");
      try {
        configureAnnotation(annotation, markupRecord([22, 36, 180, 58], {
          quadPoints: [expectedQuad],
        }), true, derived.space);
        const pageQuad = annotation.getQuadPoints()[0];
        const canonicalQuad = [...pageQuad];
        for (let index = 0; index < canonicalQuad.length; index += 2) {
          const point = pagePointToPdf([pageQuad[index], pageQuad[index + 1]], derived.space);
          canonicalQuad[index] = point[0];
          canonicalQuad[index + 1] = point[1];
        }
        expect(canonicalQuad).toEqual(expectedQuad);
      } finally {
        annotation.destroy();
      }
      page.update();
      saved = savePdf(doc);
    } finally {
      page.destroy();
      doc.destroy();
    }

    const reopened = mupdf.Document.openDocument(saved, "application/pdf").asPDF();
    expect(reopened).not.toBeNull();
    const reopenedPage: PDFPage = reopened!.loadPage(0) as PDFPage;
    try {
      const reopenedSpace = derivePageCoordinateSpace(reopenedPage.getBounds(), reopenedPage.getTransform()).space;
      const annotations = reopenedPage.getAnnotations();
      try {
        expect(annotations).toHaveLength(1);
        const actualQuad = annotations[0].getQuadPoints()[0];
        const canonicalQuad = [...actualQuad];
        for (let index = 0; index < canonicalQuad.length; index += 2) {
          const point = pagePointToPdf([actualQuad[index], actualQuad[index + 1]], reopenedSpace);
          canonicalQuad[index] = point[0];
          canonicalQuad[index + 1] = point[1];
        }
        expect(canonicalQuad).toEqual(expectedQuad);
      } finally {
        annotations.forEach((annotation) => annotation.destroy());
      }
    } finally {
      reopenedPage.destroy();
      reopened!.destroy();
    }
  });

  it("writes QuadPoints and derives a valid dictionary Rect for new text markup", () => {
    const { doc, page, space } = blankDocument();
    try {
      const annotation = page.createAnnotation("Highlight");
      try {
        configureAnnotation(annotation, markupRecord([72, 700, 200, 720], {
          quadPoints: [[72, 720, 200, 720, 72, 700, 200, 700]],
        }), true, space);

        // MuPDF 对文字标记禁止 setRect；update() 已从 QuadPoints 推导字典 /Rect。
        const rect = dictRect(annotation);
        expect(rect).not.toBeNull();
        expect(rect![2] - rect![0]).toBeGreaterThanOrEqual(128);
        expect(rect![3] - rect![1]).toBeGreaterThanOrEqual(20);
        expect(annotation.getQuadPoints()).toHaveLength(1);
        expect(annotation.getContents()).toBe("测试批注");
        expect(annotation.getOpacity()).toBeCloseTo(0.5, 3);
      } finally {
        annotation.destroy();
      }
    } finally {
      page.destroy();
      doc.destroy();
    }
  });

  it("derives a valid dictionary Rect for new ink and line annotations", () => {
    const { doc, page, space } = blankDocument();
    try {
      const ink = page.createAnnotation("Ink");
      try {
        configureAnnotation(ink, markupRecord([10, 722, 60, 772], {
          kind: "ink",
          strokes: [[[10, 772], [60, 722]]],
        }), true, space);
        expect(ink.hasInkList()).toBe(true);
        const inkRect = dictRect(ink);
        expect(inkRect).not.toBeNull();
        expect(inkRect![2] - inkRect![0]).toBeGreaterThanOrEqual(50);
      } finally {
        ink.destroy();
      }

      const line = page.createAnnotation("Line");
      try {
        configureAnnotation(line, markupRecord([100, 612, 180, 692], {
          kind: "arrow",
          points: [[100, 692], [180, 612]],
        }), true, space);
        expect(line.hasLine()).toBe(true);
        expect(line.getLineEndingStyles().end).toBe("OpenArrow");
        expect(dictRect(line)).not.toBeNull();
      } finally {
        line.destroy();
      }
    } finally {
      page.destroy();
      doc.destroy();
    }
  });

  it("keeps note Rect behaviour and survives a save/reopen roundtrip", () => {
    const { doc, page, space } = blankDocument();
    let saved: Uint8Array;
    try {
      const note = page.createAnnotation("Text");
      try {
        configureAnnotation(note, markupRecord([24, 724, 44, 744], { kind: "note" }), true, space);
      } finally {
        note.destroy();
      }
      const highlight = page.createAnnotation("Highlight");
      try {
        configureAnnotation(highlight, markupRecord([72, 700, 200, 720], {
          quadPoints: [[72, 720, 200, 720, 72, 700, 200, 700]],
        }), true, space);
      } finally {
        highlight.destroy();
      }
      page.update();
      saved = savePdf(doc);
    } finally {
      page.destroy();
      doc.destroy();
    }

    const reopened = mupdf.Document.openDocument(saved, "application/pdf").asPDF();
    expect(reopened).not.toBeNull();
    const reopenedPage: PDFPage = reopened!.loadPage(0) as PDFPage;
    try {
      const annotations = reopenedPage.getAnnotations();
      try {
        expect(annotations).toHaveLength(2);
        for (const annotation of annotations) {
          expect(dictRect(annotation)).not.toBeNull();
        }
        const highlight = annotations.find((annotation) => annotation.getType() === "Highlight");
        expect(highlight?.hasQuadPoints()).toBe(true);
        expect(highlight?.getContents()).toBe("测试批注");
        const note = annotations.find((annotation) => annotation.getType() === "Text");
        expect(note?.getRect()[0]).toBeCloseTo(24, 3);
      } finally {
        annotations.forEach((annotation) => annotation.destroy());
      }
    } finally {
      reopenedPage.destroy();
      reopened!.destroy();
    }
  });
});
