import type { PdfPoint, PdfQuad } from "../pdf/contracts";

function points(quad: PdfQuad): PdfPoint[] {
  return [
    [quad[0], quad[1]],
    [quad[2], quad[3]],
    [quad[4], quad[5]],
    [quad[6], quad[7]],
  ];
}

export function mapQuad(quad: PdfQuad, transform: (point: PdfPoint) => PdfPoint): PdfQuad {
  return points(quad).flatMap((point) => transform(point)) as unknown as PdfQuad;
}

export function characterQuadStyle(quad: PdfQuad, scale: number) {
  const [origin, advanceEnd, heightEnd] = points(quad);
  const advanceX = advanceEnd[0] - origin[0];
  const advanceY = advanceEnd[1] - origin[1];
  const heightX = heightEnd[0] - origin[0];
  const heightY = heightEnd[1] - origin[1];
  const width = Math.hypot(advanceX, advanceY);
  const height = Math.hypot(heightX, heightY);
  if (width < 1e-6 || height < 1e-6) return null;
  return {
    left: origin[0] * scale,
    top: origin[1] * scale,
    width: width * scale,
    height: height * scale,
    transform: `matrix(${advanceX / width}, ${advanceY / width}, ${heightX / height}, ${heightY / height}, 0, 0)`,
  };
}

export function quadClipPath(quad: PdfQuad, scale: number): string {
  const quadPoints = points(quad);
  const perimeter = [quadPoints[0], quadPoints[1], quadPoints[3], quadPoints[2]];
  return `polygon(${perimeter.map(([x, y]) => `${x * scale}px ${y * scale}px`).join(", ")})`;
}
