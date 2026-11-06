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
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (!d.open) d.showModal();
    const closed = () => closeRef.current();
    d.addEventListener("close", closed);
    return () => {
      d.removeEventListener("close", closed);
      if (d.open) d.close();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      className="palette-dialog"
      aria-label="Find a paid tool"
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
