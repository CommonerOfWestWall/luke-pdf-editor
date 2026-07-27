import { describe, expect, it } from "vitest";
import {
  ANNOTATION_TOOL_SHORTCUTS,
  annotationToolFromShortcut,
} from "./annotation-shortcuts";

describe("annotation tool shortcuts", () => {
  it("maps every visible annotation tool to a unique single-key shortcut", () => {
    expect(ANNOTATION_TOOL_SHORTCUTS.map(({ shortcut }) => shortcut)).toEqual([
      "H",
      "U",
      "S",
      "W",
      "N",
      "T",
    ]);
    expect(new Set(ANNOTATION_TOOL_SHORTCUTS.map(({ shortcut }) => shortcut)).size)
      .toBe(ANNOTATION_TOOL_SHORTCUTS.length);
  });

  it.each([
    ["h", "highlight"],
    ["U", "underline"],
    ["s", "strikeout"],
    ["W", "squiggly"],
    ["n", "note"],
    ["T", "freeText"],
  ] as const)("maps %s to %s without requiring a modifier", (key, expected) => {
    expect(annotationToolFromShortcut({
      key,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      repeat: false,
    })).toBe(expected);
  });

  it("does not steal modified or repeated keyboard commands", () => {
    expect(annotationToolFromShortcut({
      key: "h",
      altKey: false,
      ctrlKey: true,
      metaKey: false,
      repeat: false,
    })).toBeNull();
    expect(annotationToolFromShortcut({
      key: "h",
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      repeat: true,
    })).toBeNull();
  });
});
