export interface PaletteCommand {
  id: string;
  label: string;
  category: string;
  shortcut?: string;
  keywords?: readonly string[];
  disabled?: boolean;
  restoreFocusAfterRun?: boolean;
  run: () => void;
}

export function filterPaletteCommands(commands: readonly PaletteCommand[], query: string): PaletteCommand[] {
  const normalized = query.trim().toLocaleLowerCase("zh-CN");
  if (!normalized) return [...commands];
  return commands.filter((command) => [command.label, command.category, ...(command.keywords ?? [])]
    .some((value) => value.toLocaleLowerCase("zh-CN").includes(normalized)));
}

export function nextEnabledCommandIndex(
  commands: readonly PaletteCommand[],
  currentIndex: number,
  direction: 1 | -1,
): number {
  if (commands.length === 0 || commands.every(({ disabled }) => disabled)) return -1;
  let index = currentIndex;
  for (let count = 0; count < commands.length; count += 1) {
    index = (index + direction + commands.length) % commands.length;
    if (!commands[index].disabled) return index;
  }
  return -1;
}
