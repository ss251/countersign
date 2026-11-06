import { useEffect, useRef } from "react";
import { navigate } from "../../app/router.tsx";
import { api, useResource } from "../../lib/api.ts";
import { Assistant } from "./Assistant.tsx";

/**
 * ⌘K from any screen: the palette in a modal dialog near the top of the viewport. The dialog traps
 * focus and closes on Esc or a click outside. It opens without animation: a palette is a
 * hundred-a-day action, and motion would only make it feel slower. Enter hands the query and the
 * chosen offer to the assistant's page, where the purchase card opens.
 */
export function PaletteDialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const envelope = useResource(() => api.envelope(), []);

  // Open once; never close from a cleanup. React runs effects twice in development, and a close()
  // there fired a late "close" event that unmounted the dialog the moment it appeared. Unmounting
  // removes it from the top layer anyway.
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      className="palette-dialog"
      aria-label="Find a paid tool"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) ref.current?.close();
      }}
    >
      <Assistant
        envelope={envelope}
        layout="overlay"
        onOpen={(q, hash) => navigate(`/assistant?q=${encodeURIComponent(q)}&pick=${hash}`)}
      />
    </dialog>
  );
}
