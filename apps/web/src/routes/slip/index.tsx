import { useEffect, useState } from "react";
import type { CountersignPayload, Slip } from "@countersign/core";
import type { PageProps } from "../../app/routes.ts";
import { Link } from "../../app/router.tsx";
import { api, useResource } from "../../lib/api.ts";
import { formatDateTime, formatMoney, RAIL_LABEL, usd } from "../../lib/format.ts";
import { verifySlip, type Verdict as VerdictData } from "../../lib/verify.ts";
import { Mark } from "../../ui/Mark.tsx";
import { RailCard } from "../../ui/RailCard.tsx";
import { ReceiptTree } from "../../ui/ReceiptTree.tsx";
import { Verdict } from "../../ui/Verdict.tsx";
import { Amount, Button, Empty, FixtureNote, Hash, KV } from "../../ui/primitives.tsx";
import "../../ui/page.css";
import "./slip.css";

/** A slip: the receipt minted on release, readable by a person and checkable by anyone. */
export default function SlipPage({ params }: PageProps) {
  const hash = params[0] ?? "";
  const view = useResource(() => api.slip(hash), [hash]);
  const children = view.data?.slip.body.children.length ?? 0;
  const tree = useResource(() => api.tree(hash), [hash, children > 0]);
  const [verdict, setVerdict] = useState<VerdictData | null>(null);

  useEffect(() => {
    setVerdict(null);
    if (view.data) void verifySlip(view.data.slip).then(setVerdict);
  }, [view.data]);

  if (view.loading && !view.data) return <div className="page" aria-busy="true" />;
  if (!view.data) {
    return (
      <div className="page">
        <Empty title="No slip with that hash.">
          Check the hash, or paste the slip into <Link to="/verify">the verifier</Link>. It checks a slip without the hub.
        </Empty>
      </div>
    );
  }

  const { slip, title, sellerName, declaration } = view.data;
  const { body } = slip;
  const money = usd(body.amount, body.rail);

  return (
    <div className="page">
      <div className="page__split">
        <article className="slip" aria-labelledby="slip-title">
          <header className="slip__head">
            <span className="slip__brand">
              <Mark size={18} />
              <span className="mono">slip</span>
            </span>
            <span className="slip__head-end">
              <FixtureNote show={view.source === "fixtures"} />
              <span className="status status--released">Released</span>
            </span>
          </header>

          <div className="slip__lead">
            <div className="slip__lead-text">
              <h1 id="slip-title" className="slip__title">
                {title}
              </h1>
              <p className="slip__sub">
                {sellerName} was paid on {RAIL_LABEL[body.rail]}, delivered {formatDateTime(body.deliveredAt)}
              </p>
            </div>
            <Amount money={money} size="xl" />
          </div>

          <Perforation />

          <div className="slip__seam">
            <section className="slip__half slip__half--offer" aria-labelledby="half-offer">
              <h2 id="half-offer" className="slip__half-title">
                Offer
              </h2>
              <p className="slip__half-who">The seller's half</p>
              <KV
                rows={[
                  ["Offer hash", <Hash value={body.offerHash} label="offer hash" />],
                  ["Seller", <Hash value={body.seller} label="seller address" />],
                  ["Pays to", <Hash value={body.payTo} label="payee" />],
                  ["Job", <Hash value={body.jobId} label="job id" />],
                ]}
              />
            </section>
            <section className="slip__half slip__half--buyer" aria-labelledby="half-buyer">
              <h2 id="half-buyer" className="slip__half-title">
                Countersignature
              </h2>
              <p className="slip__half-who">The buyer's half</p>
              <BuyerHalf slip={slip} />
            </section>
          </div>

          <Perforation />

          <section className="slip__section" aria-labelledby="sec-delivery">
            <h2 id="sec-delivery" className="slip__section-title">
              Delivery
            </h2>
            <KV
              rows={[
                ["Input hash", <Hash value={body.inputHash} label="input hash" />],
                ["Output hash", <Hash value={body.outputHash} label="output hash" />],
                ["Delivered", <span className="num">{formatDateTime(body.deliveredAt)}</span>],
              ]}
            />
          </section>

          <section className="slip__section" aria-labelledby="sec-settlement">
            <h2 id="sec-settlement" className="slip__section-title">
              Settlement
            </h2>
            <RailCard declaration={declaration} tx={slip.settlement.transaction} />
          </section>

          <section className="slip__section" aria-labelledby="sec-seal">
            <h2 id="sec-seal" className="slip__section-title">
              Seller's signature
            </h2>
            <KV
              rows={[
                ["Slip hash", <Hash value={slip.hash} head={10} tail={8} label="slip hash" />],
                ["Signature", <Hash value={slip.sellerSig} head={10} tail={8} label="seller signature" />],
                ["Signs", <span className="mono">Release(jobId, slipHash)</span>],
              ]}
            />
          </section>

          {children > 0 && tree.data ? (
            <section className="slip__section" aria-labelledby="sec-tree">
              <h2 id="sec-tree" className="slip__section-title">
                Receipt tree
              </h2>
              <ReceiptTree tree={tree.data} current={slip.hash} />
              <p className="section__note">
                To serve this call the seller bought {children} more. Their slip hashes sit inside this slip's body, so
                this signature commits to every one of them.
              </p>
            </section>
          ) : null}

          <footer className="slip__foot">
            <Link to={`/verify/${slip.hash}`} className="btn btn--primary">
              Verify this slip
            </Link>
            <Button variant="secondary" onClick={() => download(slip, title)}>
              Download slip.json
            </Button>
          </footer>
        </article>

        <aside className="page__rail" aria-label="Verification">
          <Verdict verdict={verdict} />
          <p className="section__note">
            Anyone can repeat this with the slip alone: the hash, the seller's signature and the buyer's countersignature
            are all inside it. {formatMoney(money)} moved on {declaration.network}.
          </p>
        </aside>
      </div>
    </div>
  );
}

function BuyerHalf({ slip }: { slip: Slip }) {
  const { body } = slip;
  const accepted = slip.payment.accepted;
  if (accepted.scheme === "countersign") {
    const p = slip.payment.payload as unknown as CountersignPayload;
    return (
      <KV
        rows={[
          ["Buyer", <Hash value={p.terms.buyer} label="buyer address" />],
          [
            "Amount",
            <span className="slip__amount">
              <Amount money={usd(p.terms.amount, body.rail)} size="sm" />
              <span className="mono slip__atomic">{p.terms.amount}</span>
            </span>,
          ],
          ["Deadline", <span className="num">{formatDateTime(p.terms.deadline)}</span>],
          ["Signature", <Hash value={p.signature} label="countersignature" />],
        ]}
      />
    );
  }
  return (
    <KV
      rows={[
        ["Buyer", <Hash value={body.buyer} label="buyer" />],
        [
          "Amount",
          <span className="slip__amount">
            <Amount money={usd(accepted.amount, body.rail)} size="sm" />
            <span className="mono slip__atomic">{accepted.amount}</span>
          </span>,
        ],
        ["Scheme", <span className="mono">x402 {accepted.scheme}</span>],
        ["Network", <span className="mono">{accepted.network}</span>],
      ]}
    />
  );
}

function Perforation() {
  return <div className="slip__perf" aria-hidden="true" />;
}

function download(slip: Slip, title: string) {
  const blob = new Blob([`${JSON.stringify(slip, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `slip-${title}-${slip.hash.slice(2, 10)}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
