export type AnnotationShortcutTool =
  | "highlight"
  | "underline"
  | "strikeout"
  | "squiggly"
  | "note"
  | "freeText";

export const ANNOTATION_TOOL_SHORTCUTS: readonly {
  tool: AnnotationShortcutTool;
  label: string;
  shortcut: string;
}[] = [
  { tool: "highlight", label: "高亮", shortcut: "H" },
  { tool: "underline", label: "下划线", shortcut: "U" },
  { tool: "strikeout", label: "删除线", shortcut: "S" },
  { tool: "squiggly", label: "波浪线", shortcut: "W" },
  { tool: "note", label: "便签", shortcut: "N" },
  { tool: "freeText", label: "文本框", shortcut: "T" },
];

const TOOL_BY_SHORTCUT = new Map(
  ANNOTATION_TOOL_SHORTCUTS.map(({ shortcut, tool }) => [shortcut.toLowerCase(), tool]),
);

export function annotationToolFromShortcut(event: {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  repeat: boolean;
}): AnnotationShortcutTool | null {
  if (event.altKey || event.ctrlKey || event.metaKey || event.repeat) return null;
  return TOOL_BY_SHORTCUT.get(event.key.toLowerCase()) ?? null;
}

export function shortcutForAnnotationTool(tool: AnnotationShortcutTool): string {
  return ANNOTATION_TOOL_SHORTCUTS.find((entry) => entry.tool === tool)?.shortcut ?? "";
}
