import { useRef, useState } from "react";
import { api, type Resource } from "../../lib/api.ts";
import { signRevoke, SigningError } from "../../lib/approver.ts";
import { formatAmount, formatClock, formatMoney, remainingAtomic, usd } from "../../lib/format.ts";
import type { EnvelopeView } from "../../lib/types.ts";
import { Meter } from "../../ui/Meter.tsx";
import { approvalToken, rememberApprovalToken } from "../../lib/hub.ts";
import { Absent } from "../../ui/Absent.tsx";
import { Amount, Button, Hash } from "../../ui/primitives.tsx";
import { TokenForm } from "./Approvals.tsx";

/** The human’s limits: budget, per-seller limit, when to ask, allowlist, revoke. */
export function EnvelopeTab({ envelope }: { envelope: Resource<EnvelopeView | null> }) {
  if (envelope.source === "absent") {
    return (
      <Absent reason={envelope.reason ?? "This hub has no envelope to show."} onRetry={envelope.reload}>
        {envelope.needsToken && !approvalToken() ? (
          <TokenForm
            onSave={(t) => {
              rememberApprovalToken(t);
              envelope.reload();
            }}
          />
        ) : null}
      </Absent>
    );
  }
  const view = envelope.data;
  if (!view) return <div className="skeleton" aria-busy="true" aria-label="Loading" />;

  const env = view.envelope;
  const left = remainingAtomic(env.cap, view.spent.total);

  return (
    <div className="env">
      {view.mirror ? (
        <p className="env__mirror">
          Signed by {view.agentName} at <span className="num">{formatClock(view.mirror.signedAt)}</span>. These limits live on your
          agent’s machine and this is its signed copy, so nothing on this phone can loosen them. Change them there and it signs a
          new one.
        </p>
      ) : (
        <p className="env__mirror">Sample limits from the fixtures. No hub holds them, so nothing here can change one.</p>
      )}

      {env.revoked ? (
        <section className="env__revoked" role="status" data-testid="env-revoked">
          <p className="env__revoked-title">Revoked.</p>
          <p className="env__revoked-body">
            {`${view.agentName} is refused on every call on this hub${
              view.revokedAt === undefined ? "" : ` since ${formatClock(view.revokedAt)}`
            }. A revoked agent stays revoked here: to buy again, make a new agent key on its machine and sign a new envelope there.`}
          </p>
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
          <LimitRow label="Budget" hint="Total the agent may spend." atomic={env.cap} />
          <LimitRow label="Per seller" hint="Most the agent may pay any one seller." atomic={env.perMerchant} />
          <LimitRow
            label="Ask me above"
            hint={view.askAbove === null ? "The agent buys inside the limits without asking." : "Calls above this wait for your countersignature."}
            atomic={view.askAbove}
          />
        </div>
      </section>

      <Allowlist view={view} />

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

      {!env.revoked && view.mirror ? <Revoke agent={view.agentName} account={view.mirror.agent} onRevoked={envelope.reload} /> : null}
    </div>
  );
}

function LimitRow({
  label,
  hint,
  atomic,
}: {
  label: string;
  hint: string;
  /** Null when the limit is off, as when the agent never asks. */
  atomic: string | null;
}) {
  return (
    <div className="limit limit--read">
      <div className="limit__text">
        <span className="limit__label">{label}</span>
        <span className="limit__hint">{hint}</span>
      </div>
      {atomic === null ? <span className="limit__off">Never</span> : <Amount money={usd(atomic)} size="sm" />}
    </div>
  );
}

function Allowlist({ view }: { view: EnvelopeView }) {
  const list = view.envelope.allowlist;
  return (
    <section className="env__section" aria-labelledby="allow-title">
      <h2 id="allow-title" className="env__heading">
        Allowlist
      </h2>
      {list.length === 0 ? (
        <p className="env__muted">Empty, so the agent may pay any seller.</p>
      ) : (
        <ul className="allow">
          {list.map((a) => {
            const label = view.names[a] ?? "seller";
            return (
              <li key={a} className="allow__row">
                <span className="allow__name">{label}</span>
                <Hash value={a} label={`${label} address`} copy={false} />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function Revoke({ agent, account, onRevoked }: { agent: string; account: string; onRevoked: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const revoke = async () => {
    setError(null);
    setBusy(true);
    try {
      const signed = await signRevoke(account);
      const result = await api.revokeEnvelope(account, signed);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      dialog.current?.close();
      onRevoked();
    } catch (e) {
      if (e instanceof SigningError && e.problem === "no-key") {
        setError(
          "This phone has no approver key, so it cannot sign a revoke. Make one on the Approvals tab, and name it in your agent's envelope.",
        );
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="env__section env__danger">
      <Button
        variant="seal"
        block
        data-testid="env-revoke"
        onClick={() => {
          setError(null);
          dialog.current?.showModal();
        }}
      >
        Revoke the envelope
      </Button>
      <p className="env__muted">
        {`Stops ${agent} on this hub at once: the hub refuses its next call before any payment. Calls already in escrow still release or refund on their own.`}
      </p>
      <dialog ref={dialog} className="sheet" aria-labelledby="revoke-title">
        <form method="dialog" className="sheet__body">
          <h2 id="revoke-title" className="sheet__title">
            Revoke the envelope?
          </h2>
          <p className="sheet__text">
            {`${agent} will be refused on every call on this hub. A revoked agent stays revoked here; to buy again it needs a new key and a new envelope on its machine.`}
          </p>
          {error ? (
            <p className="env__error" role="alert" data-testid="env-revoke-refusal">
              {error}
            </p>
          ) : null}
          <div className="sheet__buttons">
            <Button variant="seal" block data-testid="env-revoke-confirm" disabled={busy} onClick={() => void revoke()}>
              {busy ? "Revoking" : "Revoke"}
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
