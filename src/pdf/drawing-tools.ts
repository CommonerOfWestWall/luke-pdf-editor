import type { PdfPoint, PdfRect } from "./contracts";

export type DrawingTool =
  | "ink"
  | "line"
  | "arrow"
  | "rectangle"
  | "ellipse"
  | "polygon"
  | "polyline";

export interface PointerSample {
  point: PdfPoint;
  pressure: number;
}

export interface DrawingGeometry {
  rect: PdfRect;
  points?: readonly PdfPoint[];
  strokes?: readonly (readonly PdfPoint[])[];
}

const DEFAULT_PRESSURE = 0.5;
const MINIMUM_VISIBLE_SIZE = 0.5;

function distance(a: PdfPoint, b: PdfPoint): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

function samePoint(a: PdfPoint, b: PdfPoint): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

function boundsForPoints(points: readonly PdfPoint[]): PdfRect {
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

function distinctPointCount(points: readonly PdfPoint[]): number {
  return new Set(points.map(([x, y]) => `${x}:${y}`)).size;
}

function polygonArea(points: readonly PdfPoint[]): number {
  let twiceArea = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    twiceArea += current[0] * next[1] - next[0] * current[1];
  }
  return Math.abs(twiceArea) / 2;
}

export function normalizePointerPressure(pointerType: string, pressure: number): number {
  if (pointerType === "mouse" || !Number.isFinite(pressure)) return DEFAULT_PRESSURE;
  return Math.min(1, Math.max(0, pressure));
}

/**
 * Removes dense intermediate input events without dropping the final pointer
 * position. This is deliberately not a curve simplifier: committed InkList
 * vertices must remain predictable until visual-error based simplification has
 * its own compatibility tests.
 */
export function sampleStroke(
  samples: readonly PointerSample[],
  minimumDistance = MINIMUM_VISIBLE_SIZE,
): PointerSample[] {
  if (samples.length === 0) return [];
  const result: PointerSample[] = [{ ...samples[0], point: [...samples[0].point] as PdfPoint }];

  for (let index = 1; index < samples.length - 1; index += 1) {
    const candidate = samples[index];
    if (distance(result[result.length - 1].point, candidate.point) >= minimumDistance) {
      result.push({ ...candidate, point: [...candidate.point] as PdfPoint });
    }
  }

  if (samples.length > 1) {
    const finalSample = samples[samples.length - 1];
    if (samePoint(result[result.length - 1].point, finalSample.point)) {
      result[result.length - 1] = { ...finalSample, point: [...finalSample.point] as PdfPoint };
    } else {
      result.push({ ...finalSample, point: [...finalSample.point] as PdfPoint });
    }
  }

  return result;
}

export function buildDrawingGeometry(
  tool: DrawingTool,
  inputPoints: readonly PdfPoint[],
): DrawingGeometry {
  const points = inputPoints.map((point) => [...point] as PdfPoint);
  if (points.some(([x, y]) => !Number.isFinite(x) || !Number.isFinite(y))) {
    throw new Error("绘图几何必须使用有限坐标");
  }
  const rect = points.length > 0 ? boundsForPoints(points) : null;

  switch (tool) {
    case "ink":
      if (distinctPointCount(points) < 2 || !rect) {
        throw new Error("墨迹至少需要 2 个不同点");
      }
      return { rect, strokes: [points] };
    case "line":
    case "arrow": {
      if (points.length < 2 || distance(points[0], points[1]) < MINIMUM_VISIBLE_SIZE) {
        throw new Error("直线或箭头过短");
      }
      const endpoints = [points[0], points[1]] as const;
      return { rect: boundsForPoints(endpoints), points: endpoints };
    }
    case "rectangle":
    case "ellipse":
      if (!rect || rect[2] - rect[0] < MINIMUM_VISIBLE_SIZE || rect[3] - rect[1] < MINIMUM_VISIBLE_SIZE) {
        throw new Error("矩形或椭圆过小");
      }
      return { rect };
    case "polygon":
      if (!rect || distinctPointCount(points) < 3) {
        throw new Error("多边形至少需要 3 个不同顶点");
      }
      if (polygonArea(points) < MINIMUM_VISIBLE_SIZE * MINIMUM_VISIBLE_SIZE) {
        throw new Error("多边形面积过小");
      }
      return { rect, points };
    case "polyline":
      if (!rect || distinctPointCount(points) < 2) {
        throw new Error("折线至少需要 2 个不同顶点");
      }
      return { rect, points };
  }
}
