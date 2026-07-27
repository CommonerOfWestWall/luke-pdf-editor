import type { AffineMatrix, PageCoordinateSpace, PdfPoint, PdfRect } from "./contracts";

export interface PageTransform {
  width: number;
  height: number;
  scale: number;
  rotation: 0 | 90 | 180 | 270;
}

export function transformAffinePoint(point: PdfPoint, matrix: AffineMatrix): PdfPoint {
  const [x, y] = point;
  const [a, b, c, d, e, f] = matrix;
  return [x * a + y * c + e, x * b + y * d + f];
}

export function invertAffine(matrix: AffineMatrix): AffineMatrix {
  const [a, b, c, d, e, f] = matrix;
  const determinant = a * d - b * c;
  if (Math.abs(determinant) < 1e-12) throw new Error("页面坐标矩阵不可逆");
  const inverseA = d / determinant;
  const inverseB = -b / determinant;
  const inverseC = -c / determinant;
  const inverseD = a / determinant;
  return [
    inverseA,
    inverseB,
    inverseC,
    inverseD,
    -e * inverseA - f * inverseC,
    -e * inverseB - f * inverseD,
  ];
}

function transformRect(rect: PdfRect, transform: (point: PdfPoint) => PdfPoint): PdfRect {
  const points = [
    transform([rect[0], rect[1]]),
    transform([rect[2], rect[1]]),
    transform([rect[2], rect[3]]),
    transform([rect[0], rect[3]]),
  ];
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

export function derivePageCoordinateSpace(
  pageBounds: PdfRect,
  canonicalToPage: AffineMatrix,
): { space: PageCoordinateSpace; width: number; height: number } {
  const pageToPdf = invertAffine(canonicalToPage);
  const pdfBounds = transformRect(pageBounds, (point) => transformAffinePoint(point, pageToPdf));
  return {
    space: { canonicalToPage, pdfOrigin: [pdfBounds[0], pdfBounds[1]] },
    width: pdfBounds[2] - pdfBounds[0],
    height: pdfBounds[3] - pdfBounds[1],
  };
}

export function pagePointToPdf(point: PdfPoint, space: PageCoordinateSpace): PdfPoint {
  const raw = transformAffinePoint(point, invertAffine(space.canonicalToPage));
  return [raw[0] - space.pdfOrigin[0], raw[1] - space.pdfOrigin[1]];
}

export function pdfPointToPage(point: PdfPoint, space: PageCoordinateSpace): PdfPoint {
  return transformAffinePoint(
    [point[0] + space.pdfOrigin[0], point[1] + space.pdfOrigin[1]],
    space.canonicalToPage,
  );
}

export function pageRectToPdf(rect: PdfRect, space: PageCoordinateSpace): PdfRect {
  return transformRect(rect, (point) => pagePointToPdf(point, space));
}

export function pdfRectToPage(rect: PdfRect, space: PageCoordinateSpace): PdfRect {
  return transformRect(rect, (point) => pdfPointToPage(point, space));
}

export function pdfPointToViewport(point: PdfPoint, transform: PageTransform): PdfPoint {
  const [x, y] = point;
  const { width, height, scale, rotation } = transform;

  switch (rotation) {
    case 0:
      return [x * scale, (height - y) * scale];
    case 90:
      return [y * scale, x * scale];
    case 180:
      return [(width - x) * scale, y * scale];
    case 270:
      return [(height - y) * scale, (width - x) * scale];
  }
}

export function viewportPointToPdf(point: PdfPoint, transform: PageTransform): PdfPoint {
  const [x, y] = point;
  const { width, height, scale, rotation } = transform;
  const sx = x / scale;
  const sy = y / scale;

  switch (rotation) {
    case 0:
      return [sx, height - sy];
    case 90:
      return [sy, sx];
    case 180:
      return [width - sx, sy];
    case 270:
      return [width - sy, height - sx];
  }
}

/**
 * Converts a point in the user-rotated page DOM back into MuPDF's unrotated,
 * top-left page coordinate space. Intrinsic page rotation is handled later by
 * `pagePointToPdf`.
 */
export function viewportPointToPage(point: PdfPoint, transform: PageTransform): PdfPoint {
  const [x, y] = point;
  const { width, height, scale, rotation } = transform;
  const sx = x / scale;
  const sy = y / scale;

  switch (rotation) {
    case 0:
      return [sx, sy];
    case 90:
      return [sy, height - sx];
    case 180:
      return [width - sx, height - sy];
    case 270:
      return [width - sy, sx];
  }
}

export function pdfRectToViewport(rect: PdfRect, transform: PageTransform): PdfRect {
  const corners: PdfPoint[] = [
    [rect[0], rect[1]],
    [rect[2], rect[1]],
    [rect[2], rect[3]],
    [rect[0], rect[3]],
  ];
  const points = corners.map((point) => pdfPointToViewport(point, transform));
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}
