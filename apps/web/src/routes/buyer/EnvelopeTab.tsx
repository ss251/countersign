import { useId, useRef, useState, type FormEvent } from "react";
import { AmountError, parseUnits } from "@countersign/core";
import type { Resource } from "../../lib/api.ts";
import { formatAmount, formatMoney, remaining } from "../../lib/format.ts";
import type { Envelope, Hex, Money } from "../../lib/types.ts";
import { Amount, Button, Hash } from "../../ui/primitives.tsx";
import { Meter } from "../../ui/Meter.tsx";

/** The human's limits: budget cap, per-seller limit, when to ask, allowlist, revoke. */
export function EnvelopeTab({ envelope }: { envelope: Resource<Envelope> }) {
  const env = envelope.data;
  if (!env) return <div className="skeleton" aria-busy="true" aria-label="Loading" />;

  const update = (patch: Partial<Envelope>) => envelope.set({ ...env, ...patch });
  const left = remaining(env.cap, env.spent);

  return (
    <div className="env">
      {env.revoked ? (
        <section className="env__revoked" role="status">
          <p className="env__revoked-title">Revoked.</p>
          <p className="env__revoked-body">{env.agent} is refused on every call until you issue a new envelope.</p>
          <Button variant="primary" block onClick={() => update({ revoked: false })}>
            Issue a new envelope
          </Button>
        </section>
      ) : null}

      <section className="env__budget" aria-label="Spending today">
        <p className="env__eyebrow">{env.agent} can still spend today</p>
        <Amount money={left} size="xl" />
        <Meter value={BigInt(env.spent.amount)} max={BigInt(env.cap.amount)} label="Spent of today's cap" />
        <p className="env__budget-note num">
          {formatAmount(env.spent)} of {formatMoney(env.cap)} spent. Resets at midnight.
        </p>
      </section>

      <section className="env__section" aria-labelledby="limits-title">
        <h2 id="limits-title" className="env__heading">
          Limits
        </h2>
        <div className="env__rows">
          <LimitRow label="Daily cap" hint="Total the agent may spend in a day." money={env.cap} onSave={(cap) => update({ cap })} />
          <LimitRow
            label="Per seller"
            hint="Most the agent may pay one seller in a day."
            money={env.perMerchant}
            onSave={(perMerchant) => update({ perMerchant })}
          />
          <LimitRow
            label="Ask me above"
            hint="Calls above this wait for your countersignature."
            money={env.askAbove}
            onSave={(askAbove) => update({ askAbove })}
          />
        </div>
      </section>

      <Allowlist env={env} onChange={(allowlist) => update({ allowlist })} />

      {env.gatewayBalance ? (
        <section className="env__section" aria-labelledby="gateway-title">
          <h2 id="gateway-title" className="env__heading">
            Gateway balance
          </h2>
          <div className="env__gateway">
            <Amount money={env.gatewayBalance} size="lg" />
            <p className="env__muted">Deposited once with Circle Gateway. Nanopayments draw from it, call by call.</p>
          </div>
        </section>
      ) : null}

      {env.revoked ? null : <Revoke agent={env.agent} onRevoke={() => update({ revoked: true })} />}
    </div>
  );
}

function LimitRow({ label, hint, money, onSave }: { label: string; hint: string; money: Money; onSave: (m: Money) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(formatAmount(money).replace(/,/g, ""));
  const [error, setError] = useState<string | null>(null);
  const id = useId();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    try {
      const atomic = parseUnits(value.trim(), money.asset.decimals);
      onSave({ ...money, amount: atomic.toString() });
      setEditing(false);
      setError(null);
    } catch (err) {
      setError(err instanceof AmountError ? `Enter an amount like 0.25, up to ${money.asset.decimals} decimals.` : String(err));
    }
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
            setValue(formatAmount(money).replace(/,/g, ""));
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
          autoComplete="off"
          autoFocus
          value={value}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(e) => setValue(e.target.value)}
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

function Allowlist({ env, onChange }: { env: Envelope; onChange: (list: Envelope["allowlist"]) => void }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [error, setError] = useState<string | null>(null);

  const add = (e: FormEvent) => {
    e.preventDefault();
    const a = address.trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(a)) {
      setError("Enter the seller's address: 0x and 40 hex characters.");
      return;
    }
    if (env.allowlist.some((s) => s.address.toLowerCase() === a.toLowerCase())) {
      setError("That seller is already on the list.");
      return;
    }
    onChange([...env.allowlist, { name: name.trim() || "seller", address: a as Hex }]);
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
      {env.allowlist.length === 0 ? (
        <p className="env__muted">No sellers yet. The agent can buy from no one until you add one.</p>
      ) : (
        <ul className="allow">
          {env.allowlist.map((s) => (
            <li key={s.address} className="allow__row">
              <span className="allow__name">{s.name}</span>
              <Hash value={s.address} label={`${s.name} address`} copy={false} />
              <Button
                variant="quiet"
                className="allow__remove"
                aria-label={`Remove ${s.name}`}
                onClick={() => onChange(env.allowlist.filter((x) => x.address !== s.address))}
              >
                Remove
              </Button>
            </li>
          ))}
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
              onChange={(e) => setAddress(e.target.value)}
              autoComplete="off"
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
      <p className="env__muted">Stops {agent} at once. Calls already in escrow still settle or refund on their own.</p>
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
