import { Component, Suspense, useEffect, type ErrorInfo, type ReactNode } from "react";
import { Link, useLocation } from "./router.tsx";
import { hasRoute, resolve, VIEWS } from "./routes.ts";
import { Wordmark } from "../ui/Mark.tsx";
import { useTheme } from "./theme.ts";
import "./shell.css";

export function App() {
  const location = useLocation();
  const match = resolve(location.segments);
  useTheme(location.query.get("theme"));

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.path]);

  const surface = match?.surface ?? "desk";

  return (
    <div className="shell" data-surface={surface}>
      <a className="shell__skip" href="#main" onClick={(e) => skipToMain(e)}>
        Skip to content
      </a>
      {surface === "desk" ? <TopBar active={match?.name ?? ""} /> : null}
      <main id="main" className="shell__main" tabIndex={-1}>
        <PageBoundary key={location.path}>
          <Suspense fallback={<div className="shell__loading" aria-hidden="true" />}>
            {match ? (
              <match.Page params={match.params} query={location.query} />
            ) : (
              <NotFound path={location.path} />
            )}
          </Suspense>
        </PageBoundary>
      </main>
    </div>
  );
}

function skipToMain(e: React.MouseEvent<HTMLAnchorElement>) {
  // The hash is the router, so move focus instead of following the link.
  e.preventDefault();
  document.getElementById("main")?.focus();
}

function TopBar({ active }: { active: string }) {
  return (
    <header className="topbar">
      <div className="topbar__inner">
        <Link to="/" className="topbar__brand" aria-label="countersign, home">
          <Wordmark />
        </Link>
        <nav className="topbar__nav" aria-label="Views">
          {VIEWS.map((v) => (
            <Link
              key={v.name}
              to={`/${v.name}`}
              className="topbar__link"
              aria-current={active === v.name ? "page" : undefined}
            >
              {v.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
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
