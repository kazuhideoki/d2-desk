import type { RefObject } from "react";
import { useScrollSelectedOptionIntoView } from "../../shared/hooks/useScrollSelectedOptionIntoView";
import type { WorkspaceFileEntry } from "../../types";
import { moveSelectionIndex } from "../../utils";

export type WorkspaceFilePaletteState = {
  query: string;
  files: WorkspaceFileEntry[];
  selectedIndex: number;
  loading: boolean;
  error: string | null;
};

type WorkspaceFilePaletteProps = {
  state: WorkspaceFilePaletteState;
  filteredFiles: WorkspaceFileEntry[];
  inputRef: RefObject<HTMLInputElement | null>;
  onCancel: () => void;
  onQueryChange: (query: string) => void;
  onSelectedIndexChange: (selectedIndex: number) => void;
  onOpenFile: (file: WorkspaceFileEntry) => void;
};

export function WorkspaceFilePalette({
  state,
  filteredFiles,
  inputRef,
  onCancel,
  onQueryChange,
  onSelectedIndexChange,
  onOpenFile,
}: WorkspaceFilePaletteProps) {
  const selectedOptionRef = useScrollSelectedOptionIntoView<HTMLButtonElement>(
    Math.min(state.selectedIndex, filteredFiles.length - 1),
  );

  return (
    <div className="modal-backdrop palette-backdrop" role="presentation">
      <section
        className="file-palette"
        role="dialog"
        aria-modal="true"
        aria-labelledby="file-palette-title"
        onKeyDown={(event) => {
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
                filteredFiles.length,
              ),
            );
            return;
          }
          if (event.key === "Enter") {
            event.preventDefault();
            const selectedFile =
              filteredFiles[Math.min(state.selectedIndex, filteredFiles.length - 1)];
            if (selectedFile) {
              onOpenFile(selectedFile);
            }
          }
        }}
      >
        <header className="file-palette-header">
          <h2 id="file-palette-title">Open Workspace File</h2>
          <span>{state.files.length} files</span>
        </header>
        <input
          ref={inputRef}
          aria-label="Search workspace files"
          placeholder="Search files"
          value={state.query}
          onChange={(event) => onQueryChange(event.target.value)}
        />
        <div className="file-palette-results" role="listbox" aria-label="Workspace files">
          {state.loading ? (
            <div className="file-palette-message">Indexing...</div>
          ) : state.error ? (
            <div className="file-palette-message error">{state.error}</div>
          ) : filteredFiles.length === 0 ? (
            <div className="file-palette-message">No matching files</div>
          ) : (
            filteredFiles.map((file, index) => {
              const isSelected = index === Math.min(state.selectedIndex, filteredFiles.length - 1);
              return (
                <button
                  ref={isSelected ? selectedOptionRef : null}
                  className={`file-palette-row${isSelected ? " selected" : ""}`}
                  key={file.path}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  title={file.path}
                  onMouseEnter={() => onSelectedIndexChange(index)}
                  onClick={() => onOpenFile(file)}
                >
                  <span className="file-palette-name">{file.fileName}</span>
                  <span className="file-palette-path">{file.directory}</span>
                </button>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}
