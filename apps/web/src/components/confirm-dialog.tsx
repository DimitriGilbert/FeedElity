import { createEffect, createSignal } from "solid-js";

export interface ConfirmDialogProps {
  readonly open: boolean;
  readonly title: string;
  readonly body: string;
  readonly confirmLabel: string;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

const confirmDialogButtonClass =
  "inline-flex items-center justify-center rounded-md px-3 py-1.5 text-xs font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/**
 * Minimal destructive-action confirmation dialog. The caller owns the open
 * state: `open` drives the native dialog, `onConfirm` fires the destructive
 * action (the caller then flips `open` back to false), and `onCancel` fires on
 * cancel via button or the native close path (Escape, backdrop dismissal is
 * not enabled). Because closing the dialog from the confirm path also emits
 * the native close event, the close handler skips `onCancel` when the close
 * was caused by a confirm in the same open session; the flag resets the next
 * time `open` becomes true. Confirm styling is always destructive — this
 * component only exists to gate irreversible overlay writes.
 */
export function ConfirmDialog(props: ConfirmDialogProps) {
  const [dialogRef, setDialogRef] = createSignal<HTMLDialogElement | null>(null);
  const [confirmed, setConfirmed] = createSignal(false);

  // Reset the confirm guard whenever a new open session begins so a confirm
  // in one session cannot suppress `onCancel` in the next one.
  createEffect(() => {
    if (props.open) {
      setConfirmed(false);
    }
  });

  // Drive the native dialog open/closed state idempotently. showModal()/close()
  // throw InvalidStateError if called in the wrong state, so guard each call.
  createEffect(() => {
    const dialog = dialogRef();
    if (dialog === null) {
      return;
    }

    const shouldOpen = props.open;
    if (shouldOpen && !dialog.open) {
      dialog.showModal();
    } else if (!shouldOpen && dialog.open) {
      dialog.close();
    }
  });

  return (
    <dialog
      ref={(element) => setDialogRef(element)}
      data-confirm-dialog
      aria-label={props.title}
      class="m-auto w-[min(24rem,92vw)] rounded-lg border border-border bg-popover p-0 text-popover-foreground opacity-0 backdrop:bg-background/80 open:opacity-100"
      onClose={() => {
        // A confirm closes the dialog via the parent flipping `open`, which
        // emits this native close event; skip cancel handling in that case.
        if (confirmed()) {
          return;
        }
        props.onCancel();
      }}
    >
      <div class="px-4 py-3">
        <h2 class="text-sm font-semibold text-foreground" data-confirm-dialog-title>
          {props.title}
        </h2>
        <p class="mt-1.5 text-xs leading-5 text-muted-foreground" data-confirm-dialog-body>
          {props.body}
        </p>
      </div>
      <div class="flex justify-end gap-2 border-t border-border px-4 py-3">
        <button
          type="button"
          class={`${confirmDialogButtonClass} border border-border bg-background text-foreground hover:bg-accent hover:text-accent-foreground`}
          data-confirm-dialog-cancel
          onClick={() => props.onCancel()}
        >
          Cancel
        </button>
        <button
          type="button"
          class={`${confirmDialogButtonClass} bg-destructive text-destructive-foreground hover:bg-destructive/90`}
          data-confirm-dialog-confirm
          onClick={() => {
            setConfirmed(true);
            props.onConfirm();
          }}
        >
          {props.confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
