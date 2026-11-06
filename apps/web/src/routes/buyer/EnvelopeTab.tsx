import { useId, useRef, useState, type FormEvent } from "react";
import { AmountError, parseUnits } from "@countersign/core";
import type { Resource } from "../../lib/api.ts";
import { formatAmount, formatMoney, remainingAtomic, usd } from "../../lib/format.ts";
import type { Envelope, EnvelopeView } from "../../lib/types.ts";
import { Meter } from "../../ui/Meter.tsx";
import { Amount, Button, Hash } from "../../ui/primitives.tsx";

/** The human’s limits: budget, per-seller limit, when to ask, allowlist, revoke. */
export function EnvelopeTab({ envelope }: { envelope: Resource<EnvelopeView> }) {
  const view = envelope.data;
  if (!view) return <div className="skeleton" aria-busy="true" aria-label="Loading" />;

  const env = view.envelope;
  const setEnvelope = (patch: Partial<Envelope>) => envelope.set({ ...view, envelope: { ...env, ...patch } });
  const left = remainingAtomic(env.cap, view.spent.total);

  return (
    <div className="env">
      {env.revoked ? (
        <section className="env__revoked" role="status">
          <p className="env__revoked-title">Revoked.</p>
          <p className="env__revoked-body">{view.agentName} is refused on every call until you issue a new envelope.</p>
          <Button variant="primary" block onClick={() => setEnvelope({ revoked: false })}>
            Issue a new envelope
          </Button>
        </section>
      ) : null}

      <section className="env__budget" aria-label="Budget">
        <p className="env__eyebrow">{view.agentName} can still spend</p>
        <Amount money={usd(left)} size="xl" />
        <Meter value={BigInt(view.spent.total)} max={BigInt(env.cap)} label="Spent of the budget" />
        <p className="env__budget-note num">
          {formatAmount(usd(view.spent.total))} of {formatMoney(usd(env.cap))} spent.
        </p>
      </section>

      <section className="env__section" aria-labelledby="limits-title">
        <h2 id="limits-title" className="env__heading">
          Limits
        </h2>
        <div className="env__rows">
          <LimitRow label="Budget" hint="Total the agent may spend." atomic={env.cap} onSave={(cap) => setEnvelope({ cap })} />
          <LimitRow
            label="Per seller"
            hint="Most the agent may pay any one seller."
            atomic={env.perMerchant}
            onSave={(perMerchant) => setEnvelope({ perMerchant })}
          />
          <LimitRow
            label="Ask me above"
            hint="Calls above this wait for your countersignature."
            atomic={view.askAbove}
            onSave={(askAbove) => envelope.set({ ...view, askAbove })}
          />
        </div>
      </section>

      <Allowlist view={view} onChange={(allowlist, names) => envelope.set({ ...view, names, envelope: { ...env, allowlist } })} />

      {view.gatewayBalance ? (
        <section className="env__section" aria-labelledby="gateway-title">
          <h2 id="gateway-title" className="env__heading">
            Gateway balance
          </h2>
          <div className="env__gateway">
            <Amount money={usd(view.gatewayBalance)} size="lg" />
            <p className="env__muted">Deposited once with Circle Gateway. Nanopayments draw from it, call by call.</p>
          </div>
        </section>
      ) : null}

      {env.revoked ? null : <Revoke agent={view.agentName} onRevoke={() => setEnvelope({ revoked: true })} />}
    </div>
  );
}

function LimitRow({
  label,
  hint,
  atomic,
  onSave,
}: {
  label: string;
  hint: string;
  atomic: string;
  onSave: (atomic: string) => void;
}) {
  const money = usd(atomic);
  const plain = () => formatAmount(money).replace(/,/g, "");
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(plain);
  const [error, setError] = useState<string | null>(null);
  const id = useId();

  const check = (raw: string): string | null => {
    try {
      parseUnits(raw.trim(), 6);
      return null;
    } catch (err) {
      return err instanceof AmountError ? "Enter an amount like 0.25, with at most 6 decimals." : String(err);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const problem = check(value);
    if (problem) {
      setError(problem);
      return;
    }
    onSave(parseUnits(value.trim(), 6).toString());
    setEditing(false);
    setError(null);
  };

  if (!editing) {
    return (
      <div className="limit">
        <div className="limit__text">
          <span className="limit__label">{label}</span>
          <span className="limit__hint">{hint}</span>
        </div>
        <Amount money={money} size="sm" />
        <Button
          variant="quiet"
          className="limit__change"
          aria-label={`Change ${label.toLowerCase()}`}
          onClick={() => {
            setValue(plain());
            setEditing(true);
          }}
        >
          Change
        </Button>
      </div>
    );
  }

  return (
    <form className="limit limit--editing" onSubmit={submit} noValidate>
      <label className="limit__label" htmlFor={id}>
        {label}
      </label>
      <div className="limit__input-row">
        <input
          id={id}
          className="input num"
          inputMode="decimal"
          enterKeyHint="done"
          autoComplete="off"
          data-1p-ignore
          data-lpignore="true"
          // The keyboard opens only where a fine pointer asked for it; on a phone the tap does.
          autoFocus={window.matchMedia("(pointer: fine)").matches}
          value={value}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(e) => {
            setValue(e.target.value);
            // Late to accuse, quick to forgive: once an error shows, it clears as soon as the value is fixed.
            if (error) setError(check(e.target.value));
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") setEditing(false);
          }}
        />
        <span className="limit__asset">{money.asset.symbol}</span>
      </div>
      {error ? (
        <p id={`${id}-error`} className="limit__error">
          {error}
        </p>
      ) : null}
      <div className="limit__buttons">
        <Button variant="primary" type="submit">
          Save
        </Button>
        <Button variant="quiet" onClick={() => setEditing(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function Allowlist({
  view,
  onChange,
}: {
  view: EnvelopeView;
  onChange: (allowlist: string[], names: Record<string, string>) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const list = view.envelope.allowlist;

  const add = (e: FormEvent) => {
    e.preventDefault();
    const a = address.trim().toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(a)) {
      setError("Enter the seller’s address: 0x and 40 hex characters.");
      return;
    }
    if (list.includes(a)) {
      setError("That seller is already on the list.");
      return;
    }
    onChange([...list, a], name.trim() ? { ...view.names, [a]: name.trim() } : view.names);
    setAdding(false);
    setName("");
    setAddress("");
    setError(null);
  };

  return (
    <section className="env__section" aria-labelledby="allow-title">
      <h2 id="allow-title" className="env__heading">
        Allowlist
      </h2>
      {list.length === 0 ? (
        <p className="env__muted">Empty, so the agent may pay any seller. Add one to limit it to a list.</p>
      ) : (
        <ul className="allow">
          {list.map((a) => {
            const label = view.names[a] ?? "seller";
            return (
              <li key={a} className="allow__row">
                <span className="allow__name">{label}</span>
                <Hash value={a} label={`${label} address`} copy={false} />
                <Button
                  variant="quiet"
                  className="allow__remove"
                  aria-label={`Remove ${label}`}
                  onClick={() => onChange(list.filter((x) => x !== a), view.names)}
                >
                  Remove
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      {adding ? (
        <form className="allow__form" onSubmit={add} noValidate>
          <label className="field">
            <span className="field__label">Name</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" placeholder="hedera-tools" />
          </label>
          <label className="field">
            <span className="field__label">Address</span>
            <input
              className="input mono"
              value={address}
              onChange={(e) => {
                setAddress(e.target.value);
                if (error) setError(null);
              }}
              autoComplete="off"
              data-1p-ignore
              data-lpignore="true"
              autoCapitalize="off"
              spellCheck={false}
              placeholder="0x…"
              aria-invalid={error ? true : undefined}
            />
          </label>
          {error ? <p className="limit__error">{error}</p> : null}
          <div className="limit__buttons">
            <Button variant="primary" type="submit">
              Add seller
            </Button>
            <Button variant="quiet" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <Button variant="secondary" block onClick={() => setAdding(true)}>
          Add a seller
        </Button>
      )}
    </section>
  );
}

function Revoke({ agent, onRevoke }: { agent: string; onRevoke: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  return (
    <section className="env__section env__danger">
      <Button variant="seal" block onClick={() => dialog.current?.showModal()}>
        Revoke the envelope
      </Button>
      <p className="env__muted">Stops {agent} at once. Calls already in escrow still release or refund on their own.</p>
      <dialog ref={dialog} className="sheet" aria-labelledby="revoke-title">
        <form method="dialog" className="sheet__body">
          <h2 id="revoke-title" className="sheet__title">
            Revoke the envelope?
          </h2>
          <p className="sheet__text">{agent} will be refused on every call until you issue a new envelope.</p>
          <div className="sheet__buttons">
            <Button
              variant="seal"
              block
              onClick={() => {
                dialog.current?.close();
                onRevoke();
              }}
            >
              Revoke
            </Button>
            <Button variant="secondary" block type="submit">
              Keep it
            </Button>
          </div>
        </form>
      </dialog>
    </section>
  );
}
