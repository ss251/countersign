import { Link, useLocation } from "./router.tsx";
import { VIEWS } from "./routes.ts";

const REPO = "https://github.com/ss251/countersign";

export interface SiteLinksProps {
  className: string;
  onNavigate?: () => void;
}

/** The top-level views in order, then the repository; both bars and both sheets render this one list. */
export function SiteLinks({ className, onNavigate }: SiteLinksProps) {
  const current = useLocation().segments[0];
  return (
    <>
      {VIEWS.map((v) => (
        <Link
          key={v.name}
          to={`/${v.name}`}
          className={className}
          aria-current={current === v.name ? "page" : undefined}
          onClick={onNavigate}
        >
          {v.label}
        </Link>
      ))}
      <GitHubLink className={className} />
    </>
  );
}

/** The repository link alone, for a bar that draws its views itself. */
export function GitHubLink({ className }: { className: string }) {
  return (
    <a className={className} href={REPO} target="_blank" rel="noreferrer">
      GitHub
    </a>
  );
}

SiteLinks.GitHub = GitHubLink;
