import { Fragment, type JSX, type ReactNode } from "react";
import { CopyButton } from "../../ui/primitives.tsx";
import { Integrate } from "../merchant/Integrate.tsx";
import { inline, section, type Block, type SectionId } from "./blocks.ts";

/**
 * The developer surface (STEER-0440): the onboarding guide's three copy-paste paths, in the guide's own
 * words between its markers, so the page claims nothing the guide does not. The console supplies only
 * the titles and the one line on where the key lives.
 */
const SECTIONS: Array<{ id: SectionId; title: string }> = [
  { id: "hire", title: "Hire from Claude or Cursor" },
  { id: "list", title: "Sell your API" },
  { id: "charge", title: "Charge in USDT" },
];

export const KEY_NOTE =
  "Your agent's key lives in a Privy server wallet, never on your machine. The CLI keeps only a session, and countersign logout ends it.";

export function DevelopersView({ markdown }: { markdown: string | null }): JSX.Element {
  return (
    <div className="page developers">
      <header className="page__head">
        <h1 className="page__title">Build with countersign.</h1>
        <p className="page__lede">Three ways in, each copied from the onboarding guide.</p>
        <p className="dev__note" data-testid="dev-key-note">
          {KEY_NOTE}
        </p>
      </header>

      {SECTIONS.map(({ id, title }) => {
        const blocks = section(markdown, id);
        return (
          <section key={id} className="gs" data-testid={`dev-${id}`} aria-labelledby={`dev-${id}-title`}>
            <h2 id={`dev-${id}-title`} className="gs__title">
              {title}
            </h2>
            {blocks === null ? (
              <p className="gs__pending" data-testid={`dev-pending-${id}`}>
                This part of the guide is being written in docs/onboarding.md.
              </p>
            ) : (
              <Body blocks={blocks} title={title} />
            )}
            {id === "charge" ? <Integrate /> : null}
          </section>
        );
      })}

      <p className="gs__foot">
        The full guide:{" "}
        <a href="https://github.com/ss251/countersign/blob/main/docs/onboarding.md" target="_blank" rel="noreferrer">
          docs/onboarding.md
        </a>
      </p>
    </div>
  );
}

function Body({ blocks, title }: { blocks: Block[]; title: string }) {
  const nodes: ReactNode[] = [];

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (!block) continue;

    if (block.kind === "p") {
      nodes.push(
        <p key={i} className="gs__text">
          <Inlines text={block.text} />
        </p>,
      );
      continue;
    }

    if (block.kind === "code") {
      nodes.push(
        <div key={i} className="command">
          <div className="command__head">
            <p className="label">{block.lang}</p>
            <CopyButton value={block.text} label={`${title} ${block.lang}`} />
          </div>
          <pre className="command__body mono">{block.text}</pre>
        </div>,
      );
      continue;
    }

    const items: string[] = [];
    const start = i;
    while (i < blocks.length && blocks[i]?.kind === "li") {
      items.push(blocks[i]?.text ?? "");
      i++;
    }
    i--;

    nodes.push(
      <ul key={start} className="gs__list">
        {items.map((text, j) => (
          <li key={j}>
            <Inlines text={text} />
          </li>
        ))}
      </ul>,
    );
  }

  return <>{nodes}</>;
}

function Inlines({ text }: { text: string }) {
  return (
    <>
      {inline(text).map((part, i) => {
        if (part.kind === "code") {
          return (
            <code key={i} className="mono">
              {part.text}
            </code>
          );
        }
        if (part.kind === "link") {
          return (
            <a key={i} href={part.href} target="_blank" rel="noreferrer">
              {part.text}
            </a>
          );
        }
        return <Fragment key={i}>{part.text}</Fragment>;
      })}
    </>
  );
}
