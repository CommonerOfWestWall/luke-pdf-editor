export interface ThumbnailRenderPlan {
  width: number;
  height: number;
  rasterScale: number;
}

export function thumbnailRenderPlan(
  pageWidth: number,
  pageHeight: number,
  rotation: 0 | 90 | 180 | 270,
  maxWidth: number,
  maxHeight: number,
  outputScale: number,
): ThumbnailRenderPlan {
  const safeWidth = Number.isFinite(pageWidth) && pageWidth > 0 ? pageWidth : 1;
  const safeHeight = Number.isFinite(pageHeight) && pageHeight > 0 ? pageHeight : 1;
  const rotated = rotation === 90 || rotation === 270;
  const width = rotated ? safeHeight : safeWidth;
  const height = rotated ? safeWidth : safeHeight;
  const visualScale = Math.min(Math.max(1, maxWidth) / width, Math.max(1, maxHeight) / height);
  const safeOutputScale = Math.min(2, Math.max(1, Number.isFinite(outputScale) ? outputScale : 1));

  return {
    width: Math.max(1, Math.round(width * visualScale)),
    height: Math.max(1, Math.round(height * visualScale)),
    rasterScale: visualScale * safeOutputScale,
  };
}
