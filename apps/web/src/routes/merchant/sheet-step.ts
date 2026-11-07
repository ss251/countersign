/**
 * The refund sheet and a wallet prompt (cs-e2e 02:21:26Z, the captain's booth refund). A modal <dialog> sits in the
 * browser's top layer and makes everything outside it inert, so Privy's signature prompt, which renders outside the
 * sheet, could be seen but not clicked. While a signature or a send is in flight (the sheet is locked), the sheet is
 * shown non-modally; once it unlocks, it is modal again.
 */
export interface DialogLike {
  open: boolean;
  matches(selector: string): boolean;
  close(): void;
  show(): void;
  showModal(): void;
}

/** Steps an open dialog to match `locked`. Returns what it did, or null when it was already right or is closed. */
export function stepSheet(dialog: DialogLike, locked: boolean): "non-modal" | "modal" | null {
  if (!dialog.open) return null;
  const modal = dialog.matches(":modal");
  if (locked && modal) {
    dialog.close();
    dialog.show();
    return "non-modal";
  }
  if (!locked && !modal) {
    dialog.close();
    dialog.showModal();
    return "modal";
  }
  return null;
}
