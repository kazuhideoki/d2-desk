import type { RefObject } from "react";

export type RenameDialogState = {
  id: string;
  value: string;
  error: string | null;
};

type RenameNodeDialogProps = {
  state: RenameDialogState;
  inputRef: RefObject<HTMLInputElement | null>;
  onSubmit: () => void;
  onCancel: () => void;
  onValueChange: (value: string) => void;
};

export function RenameNodeDialog({
  state,
  inputRef,
  onSubmit,
  onCancel,
  onValueChange,
}: RenameNodeDialogProps) {
  return (
    <div className="modal-backdrop" role="presentation">
      <form
        className="rename-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rename-dialog-title"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
        }}
      >
        <header className="rename-dialog-header">
          <h2 id="rename-dialog-title">Rename node</h2>
          <span>{state.id}</span>
        </header>
        <input
          ref={inputRef}
          aria-label="Node name"
          value={state.value}
          onChange={(event) => onValueChange(event.target.value)}
        />
        {state.error ? <p className="rename-dialog-error">{state.error}</p> : null}
        <footer className="rename-dialog-actions">
          <button className="dialog-button secondary" type="button" onClick={onCancel}>
            Cancel
          </button>
          <button className="dialog-button primary" type="submit">
            Rename
          </button>
        </footer>
      </form>
    </div>
  );
}
