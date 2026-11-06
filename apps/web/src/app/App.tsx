import { Component, useEffect, useState, type ErrorInfo, type ReactNode } from "react";
import { Link, useLocation } from "./router.tsx";
import { hasRoute, resolve } from "./routes.ts";
import { PaletteDialog } from "../routes/assistant/PaletteDialog.tsx";
import { SiteFooter } from "./SiteFooter.tsx";
import { TopBar } from "./TopBar.tsx";
import { useTheme } from "./theme.ts";
import "./shell.css";
import "./nav.css";

export function App() {
  const location = useLocation();
  const match = resolve(location.segments);
  useTheme(location.query.get("theme"));

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.path]);

  // ⌘K (Ctrl+K off a Mac) opens the palette from any screen; on the assistant's page it focuses that one.
  const [palette, setPalette] = useState(false);
  useEffect(() => setPalette(false), [location.path]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== "k") return;
      e.preventDefault();
      if (location.path === "/assistant") window.dispatchEvent(new Event("countersign:palette"));
      else setPalette((open) => !open);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [location.path]);

  const surface = match?.surface ?? "desk";

  return (
    <div className="shell" data-surface={surface}>
      <a className="shell__skip" href="#main" onClick={(e) => skipToMain(e)}>
        Skip to content
      </a>
      {surface === "desk" || surface === "story" ? <TopBar active={match?.name ?? ""} overlay={surface === "story"} /> : null}
      <main id="main" className="shell__main" tabIndex={-1}>
        <PageBoundary key={location.path}>
          {match ? <match.Page params={match.params} query={location.query} /> : <NotFound path={location.path} />}
        </PageBoundary>
      </main>
      <SiteFooter />
      {palette ? <PaletteDialog onClose={() => setPalette(false)} /> : null}
    </div>
  );
}

function skipToMain(e: React.MouseEvent<HTMLAnchorElement>) {
  // The hash is the router, so move focus instead of following the link.
  e.preventDefault();
  document.getElementById("main")?.focus();
}

function NotFound({ path }: { path: string }) {
  const name = path.split("/")[1] ?? "";
  const pending = name === "merchant" && !hasRoute("merchant");
  return (
    <section className="notice">
      <h1 className="notice__title">{pending ? "The merchant view is not built yet." : "Nothing at this address."}</h1>
      <p className="notice__body">
        {pending ? (
          "It arrives with the Whitechain rail."
        ) : (
          <>
            <span className="mono">{path}</span> is not a view. Start from <Link to="/">the overview</Link>.
          </>
        )}
      </p>
    </section>
  );
}

interface BoundaryState {
  error: Error | null;
}

class PageBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  override state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack);
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <section className="notice" role="alert">
        <h1 className="notice__title">This view stopped.</h1>
        <p className="notice__body">
          <span className="mono">{this.state.error.message}</span>
        </p>
        <p className="notice__body">
          <button type="button" className="notice__retry" onClick={() => this.setState({ error: null })}>
            Load it again
          </button>
        </p>
      </section>
    );
  }
}
