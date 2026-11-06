import { useEffect, useId, useState } from "react";
import { Link } from "./router.tsx";
import { VIEWS } from "./routes.ts";
import { GROUPS, type NavGroup } from "./nav.ts";
import { GitHubLink } from "./SiteLinks.tsx";
import { useThemeToggle } from "./theme.ts";
import { Wordmark } from "../ui/Mark.tsx";
import { WalletButton } from "../ui/WalletButton.tsx";

type View = (typeof VIEWS)[number];

function viewsIn(group: NavGroup): View[] {
  return VIEWS.filter((v) => v.group === group);
}

/**
 * The bar on every desk screen and over the landing. The views fold into three groups (Buy, Sell,
 * Check), each a small menu that grows from its own trigger. Over the landing's hero the bar is
 * clear, and it takes the paper once the hero has scrolled by.
 */
export function TopBar({ active, overlay }: { active: string; overlay: boolean }) {
  const [sheet, setSheet] = useState(false);
  const [open, setOpen] = useState<NavGroup | null>(null);
  const solid = useScrolledPast(overlay);

  useEffect(() => {
    setSheet(false);
    setOpen(null);
  }, [active]);

  useEffect(() => {
    if (!sheet && !open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (open) document.getElementById(`nav-trigger-${open}`)?.focus();
      setSheet(false);
      setOpen(null);
    };
    const onDown = (e: PointerEvent) => {
      if (open && !(e.target as Element | null)?.closest?.(".navgroup")) setOpen(null);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [sheet, open]);

  const currentGroup = VIEWS.find((v) => v.name === active)?.group;

  return (
    <header className="topbar" data-overlay={overlay && !solid && !sheet ? "" : undefined}>
      <div className="topbar__inner">
        <Link to="/" className="topbar__brand" aria-label="countersign, home">
          <Wordmark />
        </Link>
        <nav className="topbar__nav" aria-label="Views">
          {GROUPS.map((g) => {
            const views = viewsIn(g.id);
            if (views.length === 0) return null;
            return (
              <NavMenu
                key={g.id}
                id={g.id}
                label={g.label}
                views={views}
                active={active}
                current={currentGroup === g.id}
                open={open === g.id}
                onOpen={(o) => setOpen(o ? g.id : null)}
              />
            );
          })}
        </nav>
        <div className="topbar__end">
          <GitHubLink className="topbar__link topbar__gh" />
          <ThemeToggle />
          <span className="topbar__wallet">
            <WalletButton />
          </span>
          <button
            type="button"
            className="topbar__menu"
            aria-expanded={sheet}
            aria-controls="topbar-sheet"
            onClick={() => setSheet((o) => !o)}
          >
            {sheet ? "Close" : "Menu"}
          </button>
        </div>
      </div>
      {sheet ? (
        <nav id="topbar-sheet" className="topbar__sheet" aria-label="Views">
          {GROUPS.map((g) => {
            const views = viewsIn(g.id);
            if (views.length === 0) return null;
            return (
              <div key={g.id} className="topbar__sheet-group">
                <p className="topbar__sheet-head">{g.label}</p>
                {views.map((v) => (
                  <Link
                    key={v.name}
                    to={`/${v.name}`}
                    className="topbar__sheet-link"
                    aria-current={active === v.name ? "page" : undefined}
                    onClick={() => setSheet(false)}
                  >
                    {v.label}
                  </Link>
                ))}
              </div>
            );
          })}
          <div className="topbar__sheet-foot">
            <GitHubLink className="topbar__sheet-link" />
            <WalletButton />
          </div>
        </nav>
      ) : null}
    </header>
  );
}

interface NavMenuProps {
  id: NavGroup;
  label: string;
  views: View[];
  active: string;
  current: boolean;
  open: boolean;
  onOpen: (open: boolean) => void;
}

/** A disclosure, not an ARIA menu: a button and a short list of links that Tab walks through. */
function NavMenu({ id, label, views, active, current, open, onOpen }: NavMenuProps) {
  const listId = useId();
  return (
    <div className="navgroup" data-open={open ? "" : undefined}>
      <button
        id={`nav-trigger-${id}`}
        type="button"
        className="topbar__link navgroup__trigger"
        data-current={current ? "" : undefined}
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => onOpen(!open)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            onOpen(true);
            requestAnimationFrame(() => document.querySelector<HTMLElement>(`#${CSS.escape(listId)} a`)?.focus());
          }
        }}
      >
        {label}
        <svg className="navgroup__chev" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
          <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <ul id={listId} className="navgroup__list" hidden={!open}>
        {views.map((v) => (
          <li key={v.name}>
            <Link
              to={`/${v.name}`}
              className="navgroup__link"
              aria-current={active === v.name ? "page" : undefined}
            >
              {v.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ThemeToggle() {
  const { current, toggle } = useThemeToggle();
  const next = current === "dark" ? "light" : "dark";
  return (
    <button type="button" className="topbar__icon" onClick={toggle} aria-label={`Switch to ${next} theme`} title={`Switch to ${next} theme`}>
      {current === "dark" ? (
        <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
          <circle cx="10" cy="10" r="3.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path
            d="M10 2.5v1.75M10 15.75v1.75M2.5 10h1.75M15.75 10h1.75M4.7 4.7l1.24 1.24M14.06 14.06l1.24 1.24M4.7 15.3l1.24-1.24M14.06 5.94l1.24-1.24"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      ) : (
        <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
          <path d="M16.5 12.1A6.75 6.75 0 0 1 7.9 3.5a6.75 6.75 0 1 0 8.6 8.6Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  );
}

/** True once the page has scrolled most of a screen; only listens when the bar overlays a hero. */
function useScrolledPast(enabled: boolean): boolean {
  const [past, setPast] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let frame = 0;
    const read = () => {
      frame = 0;
      setPast(window.scrollY > window.innerHeight * 0.6);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(read);
    };
    read();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [enabled]);
  return enabled && past;
}
