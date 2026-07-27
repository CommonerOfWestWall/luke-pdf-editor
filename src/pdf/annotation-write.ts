import type { AnnotColor, PDFAnnotation, Point, Quad, Rect } from "mupdf";
import type { AnnotationRecord, PageCoordinateSpace, PdfPoint } from "./contracts";
import { pdfPointToPage, pdfRectToPage } from "./coordinates";

function transformQuad(quad: Quad, transform: (point: PdfPoint) => PdfPoint): Quad {
  const result = [...quad] as Quad;
  for (let index = 0; index < result.length; index += 2) {
    const point = transform([result[index], result[index + 1]]);
    result[index] = point[0];
    result[index + 1] = point[1];
  }
  return result;
}

/**
 * 校验新建批注携带了所属类型必需的几何数据。
 *
 * MuPDF 的 update() 会从 QuadPoints/InkList/Vertices/Line 推导 /Rect；
 * 缺少几何时推导出 INT_MAX/INT_MIN 的损坏矩形，因此必须在创建前拒绝。
 */
export function assertAnnotationCreatable(record: AnnotationRecord): void {
  switch (record.kind) {
    case "highlight":
    case "underline":
    case "strikeout":
    case "squiggly":
      if (!record.quadPoints?.length) throw new Error("文字标记批注缺少 QuadPoints 几何数据");
      return;
    case "ink":
      if (!record.strokes?.length) throw new Error("墨迹批注缺少笔画几何数据");
      return;
    case "line":
    case "arrow":
      if (!record.points || record.points.length < 2) throw new Error("直线批注缺少端点几何数据");
      return;
    case "polygon":
      if (!record.points || record.points.length < 3) throw new Error("多边形批注至少需要 3 个顶点");
      return;
    case "polyline":
      if (!record.points || record.points.length < 2) throw new Error("折线批注至少需要 2 个顶点");
      return;
    default:
      return;
  }
}

/**
 * 把记录写入批注字典并刷新 appearance stream。
 *
 * MuPDF 对文字标记、墨迹、直线和多边形等类型禁止直接 setRect
 * （抛出 “annotations have no Rect property”），这些类型的 /Rect 由
 * update() 从几何数据自动推导；只有 hasRect() 为真的类型才显式写入矩形。
 */
export function configureAnnotation(
  annotation: PDFAnnotation,
  record: AnnotationRecord,
  isNew: boolean,
  coordinateSpace: PageCoordinateSpace,
): void {
  if (isNew) annotation.setName(record.pdfName ?? record.id);
  annotation.setContents(record.contents);
  annotation.setAuthor(record.author);
  annotation.setSubject(record.subject);
  annotation.setFlags(record.flags);
  annotation.setOpacity(record.style.opacity);
  annotation.setColor([...record.style.color] as AnnotColor);
  annotation.setModificationDate(new Date(record.modifiedAt ?? Date.now()));

  if (record.createdAt) annotation.setCreationDate(new Date(record.createdAt));
  if (annotation.hasRect()) annotation.setRect(pdfRectToPage(record.rect, coordinateSpace) as Rect);
  if (annotation.hasBorder()) annotation.setBorderWidth(record.style.lineWidth);
  if (annotation.hasInteriorColor() && record.style.interiorColor) {
    annotation.setInteriorColor([...record.style.interiorColor] as AnnotColor);
  }
  if (annotation.hasQuadPoints() && record.quadPoints) {
    annotation.setQuadPoints(record.quadPoints.map((quad) => transformQuad(
      [...quad] as Quad,
      (point) => pdfPointToPage(point, coordinateSpace),
    )));
  }
  if (annotation.hasVertices() && record.points && record.kind !== "line" && record.kind !== "arrow") {
    annotation.setVertices(record.points.map((point) => [...pdfPointToPage(point, coordinateSpace)] as Point));
  }
  if (annotation.hasInkList() && record.strokes) {
    annotation.setInkList(record.strokes.map((stroke) => stroke.map((point) => [...pdfPointToPage(point, coordinateSpace)] as Point)));
  }
  if (annotation.hasLine() && record.points && record.points.length >= 2) {
    annotation.setLine(
      [...pdfPointToPage(record.points[0], coordinateSpace)] as Point,
      [...pdfPointToPage(record.points[1], coordinateSpace)] as Point,
    );
    annotation.setLineEndingStyles("None", record.kind === "arrow" ? "OpenArrow" : "None");
  }
  if (record.kind === "freeText") {
    annotation.setDefaultAppearance("Helv", record.style.fontSize ?? 12, [...record.style.color] as AnnotColor);
  }
  annotation.update();
}

/**
 * 属性编辑只允许改动内容、作者、主题、颜色、透明度和修改时间；
 * 几何、类型、创建时间、标志与身份字段由 annotation-update-policy 把关。
 */
export function updateAnnotation(annotation: PDFAnnotation, record: AnnotationRecord): void {
  annotation.setContents(record.contents);
  annotation.setAuthor(record.author);
  annotation.setSubject(record.subject);
  annotation.setOpacity(record.style.opacity);
  annotation.setColor([...record.style.color] as AnnotColor);
  annotation.setModificationDate(new Date(record.modifiedAt ?? Date.now()));
  annotation.update();
}
