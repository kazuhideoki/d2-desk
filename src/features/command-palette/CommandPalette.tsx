import { useMemo, useRef } from "react";
import type { AppCommand } from "../../shared/commands";
import { isCommandEnabled } from "../../shared/commands";
import { useScrollSelectedOptionIntoView } from "../../shared/hooks/useScrollSelectedOptionIntoView";
import { filterCommands } from "./commands";
import { moveSelectionIndex } from "../../utils";

type CommandPaletteProps = {
  commands: AppCommand[];
  query: string;
  selectedIndex: number;
  onQueryChange: (query: string) => void;
  onSelectedIndexChange: (selectedIndex: number) => void;
  onClose: () => void;
  onRunCommand: (command: AppCommand) => void;
};

export function CommandPalette({
  commands,
  query,
  selectedIndex,
  onQueryChange,
  onSelectedIndexChange,
  onClose,
  onRunCommand,
}: CommandPaletteProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const filteredCommands = useMemo(() => filterCommands(commands, query), [commands, query]);
  const cappedSelectedIndex = Math.min(selectedIndex, filteredCommands.length - 1);
  const selectedOptionRef = useScrollSelectedOptionIntoView<HTMLButtonElement>(cappedSelectedIndex);

  return (
    <div className="modal-backdrop palette-backdrop" role="presentation">
      <section
        className="file-palette command-palette"
        role="dialog"
        aria-modal="true"
        aria-labelledby="command-palette-title"
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.key === "Process") {
            return;
          }
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
            return;
          }

          const shouldMoveDown =
            event.key === "ArrowDown" ||
            (event.key.toLowerCase() === "n" &&
              event.ctrlKey &&
              !event.metaKey &&
              !event.altKey &&
              !event.shiftKey);
          const shouldMoveUp =
            event.key === "ArrowUp" ||
            (event.key.toLowerCase() === "p" &&
              event.ctrlKey &&
              !event.metaKey &&
              !event.altKey &&
              !event.shiftKey);
          if (shouldMoveDown || shouldMoveUp) {
            event.preventDefault();
            onSelectedIndexChange(
              moveSelectionIndex(
                selectedIndex,
                shouldMoveDown ? 1 : -1,
                filteredCommands.length,
              ),
            );
            return;
          }
          if (event.key === "Enter") {
            event.preventDefault();
            const command = filteredCommands[cappedSelectedIndex];
            if (command && isCommandEnabled(command)) {
              onRunCommand(command);
            }
          }
        }}
      >
        <header className="file-palette-header">
          <h2 id="command-palette-title">Command Palette</h2>
          <span>{filteredCommands.length} commands</span>
        </header>
        <input
          ref={inputRef}
          autoFocus
          aria-label="Search commands"
          placeholder="Search commands"
          value={query}
          onChange={(event) => {
            onQueryChange(event.target.value);
            onSelectedIndexChange(0);
          }}
        />
        <div className="file-palette-results" role="listbox" aria-label="Commands">
          {filteredCommands.length === 0 ? (
            <div className="file-palette-message">No matching commands</div>
          ) : (
            filteredCommands.map((command, index) => {
              const isSelected = index === cappedSelectedIndex;
              const isEnabled = isCommandEnabled(command);
              return (
                <button
                  ref={isSelected ? selectedOptionRef : null}
                  className={`file-palette-row command-palette-row${
                    isSelected ? " selected" : ""
                  }`}
                  key={command.id}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  disabled={!isEnabled}
                  title={command.title}
                  onMouseEnter={() => onSelectedIndexChange(index)}
                  onClick={() => {
                    if (isEnabled) {
                      onRunCommand(command);
                    }
                  }}
                >
                  <span className="command-palette-main">
                    <span className="file-palette-name">{command.title}</span>
                    <span className="file-palette-path">{command.category}</span>
                  </span>
                  {command.shortcut ? (
                    <span className="command-palette-shortcut">{command.shortcut}</span>
                  ) : null}
                </button>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}
