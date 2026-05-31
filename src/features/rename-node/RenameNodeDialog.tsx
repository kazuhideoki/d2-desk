import type { RefObject } from "react";

export type RenameDialogState = {
  id: string;
  value: string;
  error: string | null;
};

type RenameNodeDialogProps = {
  state: RenameDialogState;
  inputRef: RefObject<HTMLInputElement | null>;
  title?: string;
  inputLabel?: string;
  submitLabel?: string;
  onSubmit: () => void;
  onCancel: () => void;
  onValueChange: (value: string) => void;
};

export function RenameNodeDialog({
  state,
  inputRef,
  title = "Rename node",
  inputLabel = "Node name",
  submitLabel = "Rename",
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
          <h2 id="rename-dialog-title">{title}</h2>
          <span>{state.id}</span>
        </header>
        <input
          ref={inputRef}
          aria-label={inputLabel}
          value={state.value}
          onChange={(event) => onValueChange(event.target.value)}
        />
        {state.error ? <p className="rename-dialog-error">{state.error}</p> : null}
        <footer className="rename-dialog-actions">
          <button className="dialog-button secondary" type="button" onClick={onCancel}>
            Cancel
          </button>
          <button className="dialog-button primary" type="submit">
            {submitLabel}
          </button>
        </footer>
      </form>
    </div>
  );
}
