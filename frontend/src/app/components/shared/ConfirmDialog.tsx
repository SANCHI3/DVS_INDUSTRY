import { useCallback, useRef, useState, type ReactNode } from "react";
import { Modal } from "./Modal";

export interface ConfirmOptions {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  /** Red confirm button for deleting or other actions that cannot be undone. */
  danger?: boolean;
}

/**
 * The app's own confirmation dialog, used instead of the browser's confirm():
 *   const [confirmDialog, askConfirm] = useConfirm();
 *   if (!(await askConfirm({ title: "Delete record?", message: "…", danger: true }))) return;
 *   …render {confirmDialog} somewhere in the component.
 */
export function useConfirm(): [ReactNode, (options: ConfirmOptions) => Promise<boolean>] {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const ask = useCallback((next: ConfirmOptions) => {
    resolver.current?.(false);
    setOptions(next);
    return new Promise<boolean>((resolve) => { resolver.current = resolve; });
  }, []);

  const answer = (ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
    setOptions(null);
  };

  const dialog = options && (
    <Modal title={options.title} onClose={() => answer(false)} size="md">
      <div style={{ fontSize: "0.875rem", color: "#4A4A4A", lineHeight: 1.6 }}>{options.message}</div>
      <div className="flex gap-2 mt-5">
        <button type="button" onClick={() => answer(false)}
          style={{ flex: 1, padding: "0.6rem", border: "1px solid #E8E2E0", borderRadius: "0.5rem", background: "#fff", cursor: "pointer", fontSize: "0.875rem" }}>
          Cancel
        </button>
        <button type="button" autoFocus onClick={() => answer(true)}
          style={{ flex: 1, padding: "0.6rem", border: "none", borderRadius: "0.5rem", background: options.danger ? "#C0392B" : "#A52A2A", color: "#fff", cursor: "pointer", fontSize: "0.875rem", fontWeight: 600 }}>
          {options.confirmLabel ?? "Confirm"}
        </button>
      </div>
    </Modal>
  );

  return [dialog, ask];
}
