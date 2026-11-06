import { useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { formatAmount, RAIL_LABEL, shortHex } from "../lib/format.ts";
import type { JobStatus, Money, RailId } from "../lib/types.ts";
import "./ui.css";

/* Money. Blue, sans, tabular. */

type AmountSize = "sm" | "md" | "lg" | "xl";

export function Amount({ money, size = "md", className }: { money: Money; size?: AmountSize; className?: string }) {
  return (
    <span className={cx("amount num", `amount--${size}`, className)}>
      {formatAmount(money)}
      <span className="amount__asset">{money.asset.symbol}</span>
    </span>
  );
}

/* Values read glyph by glyph. */

export function Hash({
  value,
  head = 6,
  tail = 4,
  href,
  full = false,
  copy = true,
  label,
}: {
  value: string;
  head?: number;
  tail?: number;
  href?: string;
  /** Show every character, wrapping, instead of the short form. */
  full?: boolean;
  copy?: boolean;
  /** Accessible name for the copy button, e.g. "offer hash". */
  label?: string;
}) {
  const text = full ? value : shortHex(value, head, tail);
  return (
    <span className={cx("hash", full && "hash--full")}>
      {href ? (
        <a className="hash__value mono" href={href} target="_blank" rel="noreferrer" title={value}>
          {text}
        </a>
      ) : (
        <span className="hash__value mono" title={value}>
          {text}
        </span>
      )}
      {copy ? <CopyButton value={value} label={label ?? "value"} /> : null}
    </span>
  );
}

export function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="copy"
      aria-label={copied ? `Copied ${label}` : `Copy ${label}`}
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1400);
        });
      }}
    >
      {copied ? (
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
          <path d="M10.5 3.5v-.5A1.5 1.5 0 0 0 9 1.5H4A1.5 1.5 0 0 0 2.5 3v5A1.5 1.5 0 0 0 4 9.5h.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
        </svg>
      )}
    </button>
  );
}

/* Status words. Green is settled, red is refused or countersigned, blue is money held. */

const STATUS_LABEL: Record<JobStatus, string> = {
  countersigned: "Countersigned",
  held: "In escrow",
  delivered: "Delivered",
  released: "Released",
  refunded: "Refunded",
  refused: "Refused",
};

export function Status({ status, className }: { status: JobStatus; className?: string }) {
  return <span className={cx("status", `status--${status}`, className)}>{STATUS_LABEL[status]}</span>;
}

export function RailTag({ rail }: { rail: RailId }) {
  return <span className="rail-tag">{RAIL_LABEL[rail]}</span>;
}

export function Tag({ children }: { children: ReactNode }) {
  return <span className="tag">{children}</span>;
}

/* Key and value rows. */

export function KV({ rows, className }: { rows: Array<[ReactNode, ReactNode] | null | false>; className?: string }) {
  return (
    <dl className={cx("kv", className)}>
      {rows.filter(Boolean).map((row, i) => {
        const [k, v] = row as [ReactNode, ReactNode];
        return (
          <div className="kv__row" key={i}>
            <dt className="kv__key">{k}</dt>
            <dd className="kv__value">{v}</dd>
          </div>
        );
      })}
    </dl>
  );
}

/* Buttons. Ink is the default action; seal only where the act is a countersignature or a refusal. */

type ButtonVariant = "primary" | "secondary" | "quiet" | "seal";

export function Button({
  variant = "secondary",
  block = false,
  className,
  type = "button",
  ...rest
}: { variant?: ButtonVariant; block?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type={type} className={cx("btn", `btn--${variant}`, block && "btn--block", className)} {...rest} />;
}

export function Card({ children, className, as: As = "section" }: { children: ReactNode; className?: string; as?: "section" | "div" | "article" }) {
  return <As className={cx("card", className)}>{children}</As>;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <p className="empty__title">{title}</p>
      {children ? <div className="empty__body">{children}</div> : null}
    </div>
  );
}

/** Shown wherever the screen is reading stand-in data rather than the hub. */
export function FixtureNote({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <span className="fixture-note" title="The hub is not connected. These numbers are stand-ins.">
      Fixture data
    </span>
  );
}

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
