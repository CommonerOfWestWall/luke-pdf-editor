import type { PdfQuad, PdfRect } from "./contracts";

/**
 * 选区中的一个字符。line/index 是 StructuredText 阅读顺序，
 * quad 采用 MuPDF 顺序（ul、ur、ll、lr），位于未旋转页面空间。
 */
export interface MarkupCharacter {
  line: number;
  index: number;
  text: string;
  quad: PdfQuad;
}

function unionBounds(quads: readonly PdfQuad[]): { left: number; top: number; right: number; bottom: number } {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const quad of quads) {
    for (let index = 0; index < 8; index += 2) {
      left = Math.min(left, quad[index]);
      right = Math.max(right, quad[index]);
      top = Math.min(top, quad[index + 1]);
      bottom = Math.max(bottom, quad[index + 1]);
    }
  }
  return { left, top, right, bottom };
}

/**
 * 把选区字符按阅读顺序归并成文字标记 QuadPoints：每行一个四边形。
 * 正向、反向拖选和乱序输入都会得到相同的阅读顺序结果。
 */
export function quadsForMarkupSelection(characters: readonly MarkupCharacter[]): PdfQuad[] {
  const ordered = [...characters].sort((left, right) => left.line - right.line || left.index - right.index);
  const quads: PdfQuad[] = [];
  let currentLine = -1;
  let run: PdfQuad[] = [];
  const flush = () => {
    if (!run.length) return;
    const { left, top, right, bottom } = unionBounds(run);
    quads.push([left, top, right, top, left, bottom, right, bottom]);
    run = [];
  };
  for (const character of ordered) {
    if (character.line !== currentLine) {
      flush();
      currentLine = character.line;
    }
    run.push(character.quad);
  }
  flush();
  return quads;
}

/** 选中文字四边形的整体外接矩形（与输入同一坐标空间）。 */
export function rectForQuads(quads: readonly PdfQuad[]): PdfRect {
  if (!quads.length) throw new Error("无法为空选区计算外接矩形");
  const { left, top, right, bottom } = unionBounds(quads);
  return [left, top, right, bottom];
}

/** 把选区原文整理成批注内容预览：折叠空白，超长截断。 */
export function markupContentsPreview(text: string, maxLength = 80): string {
  const collapsed = text.replace(/\s+/gu, " ").trim();
  if (collapsed.length <= maxLength) return collapsed;
  return `${collapsed.slice(0, maxLength - 1)}…`;
}
