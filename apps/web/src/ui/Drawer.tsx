import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import "./drawer.css";

/*
 * A sheet that slides in from the right over the page, which stays visible and dimmed behind it.
 * It opens on the iOS drawer curve; closing is quicker than opening, then `onClose` runs, so the
 * URL that opened it can change only once the sheet is gone. Escape, the backdrop and the close
 * button all close it. Focus moves into it on open and back to where it was on close.
 */

const EXIT_MS = 200;

export function Drawer({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const [closing, setClosing] = useState(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const close = () => {
    if (closing) return;
    setClosing(true);
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    window.setTimeout(() => onCloseRef.current(), reduce ? 0 : EXIT_MS);
  };

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    panel.current?.focus({ preventScroll: true });
    const root = document.documentElement;
    const overflow = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      root.style.overflow = overflow;
      before?.focus?.({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="drawer" data-closing={closing ? "" : undefined}>
      <div className="drawer__backdrop" onClick={close} aria-hidden="true" />
      <div ref={panel} className="drawer__panel" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <header className="drawer__head">
          <h2 id={titleId} className="drawer__title">
            {title}
          </h2>
          <button type="button" className="drawer__close" onClick={close} aria-label="Close">
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </header>
        <div className="drawer__body">{children}</div>
      </div>
    </div>
  );
}
