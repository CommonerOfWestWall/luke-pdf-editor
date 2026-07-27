import { describe, expect, it, vi } from "vitest";
import { filterPaletteCommands, nextEnabledCommandIndex, type PaletteCommand } from "./command-palette";

const commands: PaletteCommand[] = [
  { id: "open", label: "打开 PDF", category: "文件", shortcut: "Ctrl+O", keywords: ["open"], run: vi.fn() },
  { id: "comment", label: "切换到批注工作区", category: "工作区", keywords: ["review"], run: vi.fn() },
  { id: "print", label: "打印", category: "文件", disabled: true, run: vi.fn() },
];

describe("filterPaletteCommands", () => {
  it("matches labels, categories and alternate keywords", () => {
    expect(filterPaletteCommands(commands, "批注").map(({ id }) => id)).toEqual(["comment"]);
    expect(filterPaletteCommands(commands, "文件").map(({ id }) => id)).toEqual(["open", "print"]);
    expect(filterPaletteCommands(commands, "open").map(({ id }) => id)).toEqual(["open"]);
  });

  it("returns all commands for a blank query", () => {
    expect(filterPaletteCommands(commands, "  ")).toEqual(commands);
  });
});

describe("nextEnabledCommandIndex", () => {
  it("wraps and skips disabled commands", () => {
    expect(nextEnabledCommandIndex(commands, 1, 1)).toBe(0);
    expect(nextEnabledCommandIndex(commands, 0, -1)).toBe(1);
  });

  it("returns -1 when no command can run", () => {
    expect(nextEnabledCommandIndex([{ ...commands[2] }], -1, 1)).toBe(-1);
  });
});
