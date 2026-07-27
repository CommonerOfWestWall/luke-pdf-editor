export class ByteLruCache<T> {
  private readonly entries = new Map<string, { value: T; bytes: number }>();
  private totalBytes = 0;

  constructor(private readonly maxBytes: number) {}

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T, bytes: number): void {
    const existing = this.entries.get(key);
    if (existing) {
      this.totalBytes -= existing.bytes;
      this.entries.delete(key);
    }
    this.entries.set(key, { value, bytes });
    this.totalBytes += bytes;
    while (this.totalBytes > this.maxBytes && this.entries.size > 1) {
      const oldestKey = this.entries.keys().next().value as string;
      const oldest = this.entries.get(oldestKey);
      this.entries.delete(oldestKey);
      this.totalBytes -= oldest?.bytes ?? 0;
    }
  }

  clear(): void {
    this.entries.clear();
    this.totalBytes = 0;
  }

  get size(): number {
    return this.entries.size;
  }
}

export const MAX_RASTER_PIXELS_PER_PAGE = 16_000_000;
export const MAX_RASTER_DIMENSION = 8_192;

export function effectiveRasterScale(
  width: number,
  height: number,
  visualScale: number,
  outputScale: number,
): number {
  const requested = Math.max(0.01, visualScale * outputScale);
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  return Math.min(
    requested,
    Math.sqrt(MAX_RASTER_PIXELS_PER_PAGE / (safeWidth * safeHeight)),
    MAX_RASTER_DIMENSION / safeWidth,
    MAX_RASTER_DIMENSION / safeHeight,
  );
}

export function bufferedPageIndexes(
  visiblePages: ReadonlySet<number>,
  pageCount: number,
  radius = 1,
): Set<number> {
  const result = new Set<number>();
  for (const pageIndex of visiblePages) {
    for (let index = pageIndex - radius; index <= pageIndex + radius; index += 1) {
      if (index >= 0 && index < pageCount) result.add(index);
    }
  }
  return result;
}

export function pageRenderKey(
  documentEpoch: number,
  renderRevision: number,
  pageIndex: number,
  rasterScale: number,
  rotation: 0 | 90 | 180 | 270,
): string {
  return `${documentEpoch}:${renderRevision}:${pageIndex}:${rasterScale.toFixed(6)}:${rotation}`;
}
