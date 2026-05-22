import type { RefObject } from "react";
import { useScrollSelectedOptionIntoView } from "../../shared/hooks/useScrollSelectedOptionIntoView";
import { moveSelectionIndex } from "../../utils";
import type { D2SymbolEntry } from "./symbolSearch";

export type SymbolPaletteState = {
  query: string;
  selectedIndex: number;
};

type SymbolPaletteProps = {
  state: SymbolPaletteState;
  symbols: D2SymbolEntry[];
  filteredSymbols: D2SymbolEntry[];
  inputRef: RefObject<HTMLInputElement | null>;
  onCancel: () => void;
  onQueryChange: (query: string) => void;
  onSelectedIndexChange: (selectedIndex: number) => void;
  onGoToSymbol: (symbolId: string) => void;
};

export function SymbolPalette({
  state,
  symbols,
  filteredSymbols,
  inputRef,
  onCancel,
  onQueryChange,
  onSelectedIndexChange,
  onGoToSymbol,
}: SymbolPaletteProps) {
  const selectedOptionRef = useScrollSelectedOptionIntoView<HTMLButtonElement>(
    Math.min(state.selectedIndex, filteredSymbols.length - 1),
  );

  return (
    <div className="modal-backdrop palette-backdrop" role="presentation">
      <section
        className="file-palette"
        role="dialog"
        aria-modal="true"
        aria-labelledby="symbol-palette-title"
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.key === "Process") {
            return;
          }
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
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
                state.selectedIndex,
                shouldMoveDown ? 1 : -1,
                filteredSymbols.length,
              ),
            );
            return;
          }
          if (event.key === "Enter") {
            event.preventDefault();
            const selectedSymbol =
              filteredSymbols[Math.min(state.selectedIndex, filteredSymbols.length - 1)];
            if (selectedSymbol) {
              onGoToSymbol(selectedSymbol.id);
            }
          }
        }}
      >
        <header className="file-palette-header">
          <h2 id="symbol-palette-title">Go to Symbol in File</h2>
          <span>{symbols.length} symbols</span>
        </header>
        <input
          ref={inputRef}
          autoFocus
          aria-label="Search file symbols"
          placeholder="Search symbols"
          value={state.query}
          onChange={(event) => onQueryChange(event.target.value)}
        />
        <div className="file-palette-results" role="listbox" aria-label="File symbols">
          {filteredSymbols.length === 0 ? (
            <div className="file-palette-message">No matching symbols</div>
          ) : (
            filteredSymbols.map((symbol, index) => {
              const isSelected = index === Math.min(state.selectedIndex, filteredSymbols.length - 1);
              return (
                <button
                  ref={isSelected ? selectedOptionRef : null}
                  className={`file-palette-row symbol-palette-row${
                    isSelected ? " selected" : ""
                  }`}
                  key={`${symbol.id}:${symbol.line}:${symbol.column}`}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  title={symbol.detail}
                  onMouseEnter={() => onSelectedIndexChange(index)}
                  onClick={() => onGoToSymbol(symbol.id)}
                >
                  <span className={`symbol-palette-kind ${symbol.kind}`}>{symbol.kind}</span>
                  <span className="file-palette-name">{symbol.name}</span>
                  <span className="file-palette-path">{symbol.detail}</span>
                  <span className="symbol-palette-line">:{symbol.line}</span>
                </button>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}
