import { useEffect, useRef, useState, type ReactNode } from "react";
import { CUSTOMER_SNIPPET, MERCHANT_SNIPPET, SNIPPET_PATHS } from "./snippet.generated.ts";

/**
 * The one install line for the published package, @countersign-hub/relay: the captain chose npm, and
 * that scope is the project's own (created 06 Nov 19:17Z). Never an @countersign/* name, which on npm
 * is another project's. Null until the package is actually published (STEER-2210, reality rule).
 */
export const INSTALL_LINE: string | null = null;

/** Lines of code, as a reader counts them: the file's lines without its final newline. */
export function lineCount(code: string): number {
  return code.replace(/\n$/, "").split("\n").length;
}

export const SNIPPET_LINES = lineCount(MERCHANT_SNIPPET) + lineCount(CUSTOMER_SNIPPET);

function Snippet({ title, path, code }: { title: string; path: string; code: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <figure className="mx-snippet">
      <figcaption className="mx-snippet__head">
        <span className="mx-snippet__title">{title}</span>
        <span className="mono mx-quiet mx-snippet__path">{path}</span>
        <span className="num mx-quiet">{lineCount(code)} lines</span>
        <button type="button" className="mx-button mx-button--small mx-button--quiet mx-snippet__copy" onClick={() => void copy()}>
          {copied ? "Copied" : "Copy"}
        </button>
      </figcaption>
      {/* Focusable, so a keyboard can scroll a line wider than the page. */}
      <pre className="mx-snippet__code" tabIndex={0} role="region" aria-label={`${title}: ${path}`}>
        <code>{code.replace(/\n$/, "")}</code>
      </pre>
    </figure>
  );
}

/** "Integrate this in twenty lines", rendered from the two files this console's own checkout runs, on the merchant desk and the seller page alike. */
export function Integrate(): ReactNode {
  return (
    <section className="mx-integrate" aria-labelledby="mx-integrate-heading">
      <div className="mx-integrate__head">
        <h2 className="mx-label" id="mx-integrate-heading">
          Integrate this in twenty lines
        </h2>
        <p className="mx-integrate__lead">
          This console&rsquo;s own checkout runs these two files, <span className="num">{SNIPPET_LINES}</span> lines in all. The
          paywall goes on your server; your customer pays from their wallet and never holds WBT.
        </p>
      </div>
      <Snippet title="On your server" path={SNIPPET_PATHS.merchant} code={MERCHANT_SNIPPET} />
      <Snippet title="In your customer’s browser" path={SNIPPET_PATHS.customer} code={CUSTOMER_SNIPPET} />
      <p className="mx-quiet mx-integrate__note">
        {INSTALL_LINE
          ? `Install with ${INSTALL_LINE}`
          : "The imports are shown under the name the v0.1.0 release publishes, @countersign-hub/relay. It is not published yet, and here the console imports the workspace package, so install nothing under that name until the release is out. On npm, @countersign/* belongs to another project: never install it."}
      </p>
    </section>
  );
}
