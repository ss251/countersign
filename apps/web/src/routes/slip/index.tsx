import { NetworkName, RailName } from "../../ui/NetworkMark.tsx";
import { useEffect, useState } from "react";
import type { CountersignPayload, Slip } from "@countersign/core";
import type { PageProps } from "../../app/routes.ts";
import { Link } from "../../app/router.tsx";
import { api, useResource } from "../../lib/api.ts";
import { formatCompleted, formatDateTime, formatMoney, networkName, RAIL_LABEL, usd } from "../../lib/format.ts";
import { canReadChain, verifySlip, type Verdict as VerdictData } from "../../lib/verify.ts";
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
  // A slip has a tree when it signed children, or when the hub recorded purchases made inside its job, so a
  // live slip always asks; fixtures ask only when the slip signed children.
  const ask = view.data !== undefined && (children > 0 || view.source === "hub");
  const tree = useResource(
    () => (ask ? api.tree(hash) : Promise.resolve({ data: undefined, source: "fixtures" as const })),
    [hash, ask],
  );
  const branches =
    tree.data !== undefined &&
    (Object.keys(tree.data.nodes).length > 1 ||
      (tree.data.missing?.length ?? 0) > 0 ||
      Object.values(tree.data.nodes).some((n) => (n.observed?.length ?? 0) > 0));
  const [verdict, setVerdict] = useState<VerdictData | null>(null);
  const [reading, setReading] = useState(false);

  useEffect(() => {
    setVerdict(null);
    if (!view.data) return;
    const { slip } = view.data;
    let live = true;
    // Show what the slip proves by itself at once, then the fifth check: the chain holding its hash.
    void verifySlip(slip).then((offline) => {
      if (!live) return;
      setVerdict(offline);
      if (view.source !== "hub" || !canReadChain(slip)) return;
      setReading(true);
      void verifySlip(slip, { readChain: true }).then((onchain) => {
        if (!live) return;
        setVerdict(onchain);
        setReading(false);
      });
    });
    return () => {
      live = false;
    };
  }, [view.data, view.source]);

  const readChain = () => {
    if (!view.data) return;
    setReading(true);
    void verifySlip(view.data.slip, { readChain: true }).then((v) => {
      setVerdict(v);
      setReading(false);
    });
  };

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
              <Hash value={slip.hash} label="slip hash" />
            </span>
            <FixtureNote show={view.source === "fixtures"} />
          </header>

          <div className="slip__lead">
            <div className="slip__lead-text">
              <h1 id="slip-title" className="slip__status">
                Released
              </h1>
              <p className="slip__what">
                <span className="slip__offer">{title}</span> · {sellerName} was paid on <RailName rail={body.rail} />
              </p>
              <p className="slip__when num">Completed on {formatCompleted(body.deliveredAt)}</p>
            </div>
            <Amount money={money} size="xl" />
          </div>
          <p className="slip__promise">
            {sellerName} was paid only after the output matched the schema. Had the deadline passed first, anyone could have
            refunded the buyer, with no ticket and no one to ask.
          </p>

          <Perforation />

          <div className="slip__seam">
            <section className="slip__half slip__half--offer" aria-labelledby="half-offer">
              <h2 id="half-offer" className="slip__half-title">
                Offer
              </h2>
              <p className="slip__half-who">The seller’s half</p>
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
              <p className="slip__half-who">The buyer’s half</p>
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
            <RailCard declaration={declaration} tx={slip.settlement.transaction} link={view.source !== "fixtures"} />
          </section>

          <section className="slip__section" aria-labelledby="sec-seal">
            <h2 id="sec-seal" className="slip__section-title">
              Seller’s signature
            </h2>
            <KV
              rows={[
                ["Slip hash", <Hash value={slip.hash} head={10} tail={8} label="slip hash" />],
                ["Signature", <Hash value={slip.sellerSig} head={10} tail={8} label="seller signature" />],
                ["Signs", <span className="mono">Release(jobId, slipHash)</span>],
              ]}
            />
          </section>

          {branches && tree.data ? (
            <section className="slip__section" aria-labelledby="sec-tree">
              <h2 id="sec-tree" className="slip__section-title">
                Receipt tree
              </h2>
              <ReceiptTree tree={tree.data} current={slip.hash} />
              <p className="section__note">
                To serve this call the seller bought {children} more. Their slip hashes sit inside this slip’s body, so
                this signature commits to every one of them.
              </p>
            </section>
          ) : null}

          <footer className="slip__foot">
            <Button variant="primary" onClick={() => download(slip, title)}>
              Download slip.json
            </Button>
            <Link to={`/verify/${slip.hash}`} className="btn btn--secondary">
              Verify it yourself
            </Link>
          </footer>
        </article>

        <aside className="page__rail" aria-label="Verification">
          <Verdict
            verdict={verdict}
            chain={{
              // Stand-in slips name transactions that are on no chain, so there is nothing to read.
              can: view.source === "hub" && canReadChain(slip),
              busy: reading,
              onRead: readChain,
              explorer:
                view.source === "hub" && declaration.explorerTx
                  ? declaration.explorerTx.replace("{tx}", encodeURIComponent(slip.settlement.transaction))
                  : undefined,
            }}
          />
          <p className="section__note">
            Anyone can repeat this with the slip alone: the hash, the seller’s signature and the buyer’s countersignature
            are all inside it. The chain answers the rest: whether {formatMoney(money)} was released on{" "}
            <NetworkName name={networkName(body.network)} />.
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
