import { useEffect, useMemo, useRef, useState } from "react";
import { SearchIcon } from "./icons";
import { filterPaletteCommands, nextEnabledCommandIndex, type PaletteCommand } from "./command-palette";

export function CommandPalette({ commands, onClose }: { commands: readonly PaletteCommand[]; onClose: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const restoreFocusRef = useRef(true);
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => filterPaletteCommands(commands, query), [commands, query]);
  const [activeId, setActiveId] = useState<string | null>(() => filtered.find(({ disabled }) => !disabled)?.id ?? null);
  const activeIndex = filtered.findIndex(({ id }) => id === activeId);

  useEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    inputRef.current?.focus();
    return () => {
      if (restoreFocusRef.current) previousFocusRef.current?.focus();
    };
  }, []);
  useEffect(() => {
    setActiveId((currentId) => {
      if (currentId && filtered.some(({ id, disabled }) => id === currentId && !disabled)) return currentId;
      return filtered.find(({ disabled }) => !disabled)?.id ?? null;
    });
  }, [filtered]);
  useEffect(() => {
    if (!activeId) return;
    document.getElementById(`palette-command-${activeId}`)?.scrollIntoView({ block: "nearest" });
  }, [activeId]);

  const execute = (command: PaletteCommand | undefined) => {
    if (!command || command.disabled) return;
    restoreFocusRef.current = command.restoreFocusAfterRun !== false;
    onClose();
    command.run();
  };

  return (
    <div className="palette-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="command-palette" role="dialog" aria-modal="true" aria-labelledby="command-palette-title" onKeyDown={(event) => {
        if (event.key === "Tab") {
          event.preventDefault();
          inputRef.current?.focus();
        }
      }}>
        <div className="palette-search">
          <SearchIcon />
          <label id="command-palette-title" className="visually-hidden" htmlFor="command-palette-input">搜索命令</label>
          <input
            id="command-palette-input"
            ref={inputRef}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded="true"
            aria-controls="command-palette-results"
            aria-activedescendant={activeIndex >= 0 ? `palette-command-${filtered[activeIndex]?.id}` : undefined}
            value={query}
            placeholder="输入命令，例如“批注”“旋转”"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") { event.preventDefault(); onClose(); }
              if (event.key === "ArrowDown") { event.preventDefault(); setActiveId(filtered[nextEnabledCommandIndex(filtered, activeIndex, 1)]?.id ?? null); }
              if (event.key === "ArrowUp") { event.preventDefault(); setActiveId(filtered[nextEnabledCommandIndex(filtered, activeIndex, -1)]?.id ?? null); }
              if (event.key === "Enter") { event.preventDefault(); execute(filtered[activeIndex]); }
            }}
          />
          <kbd>Esc</kbd>
        </div>
        <div id="command-palette-results" className="palette-results" role="listbox" aria-label="可用命令">
          {filtered.length === 0 ? <p className="palette-empty">没有匹配的命令</p> : filtered.map((command, index) => (
            <button
              key={command.id}
              id={`palette-command-${command.id}`}
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              className={index === activeIndex ? "is-active" : ""}
              disabled={command.disabled}
              onFocus={() => { if (!command.disabled) setActiveId(command.id); }}
              onMouseEnter={() => { if (!command.disabled) setActiveId(command.id); }}
              onClick={() => execute(command)}
            >
              <span><strong>{command.label}</strong><small>{command.category}</small></span>
              {command.shortcut && <kbd>{command.shortcut}</kbd>}
            </button>
          ))}
        </div>
        <footer><span>↑↓ 选择</span><span>Enter 执行</span><span>仅显示本版本可发现的命令</span></footer>
      </section>
    </div>
  );
}
