import { useEffect, useId, useRef, useState } from "react";
import type { Slip } from "@countersign/core";
import type { PageProps } from "../../app/routes.ts";
import { Link } from "../../app/router.tsx";
import { api } from "../../lib/api.ts";
import { canReadChain, explorerFor, parseSlip, verifySlip, type Verdict as VerdictData } from "../../lib/verify.ts";
import { Verdict } from "../../ui/Verdict.tsx";
import { Button } from "../../ui/primitives.tsx";
import "../../ui/page.css";
import "./verify.css";

/**
 * Paste a slip, open a file, or arrive with a hash. The check runs here, from the slip’s
 * own bytes, which is why it still answers when the hub is down.
 */
export default function VerifyPage({ params }: PageProps) {
  const hash = params[0];
  const [text, setText] = useState("");
  const [verdict, setVerdict] = useState<VerdictData | null>(null);
  const [checking, setChecking] = useState(false);
  const [current, setCurrent] = useState<Slip | null>(null);
  const [fromFixtures, setFromFixtures] = useState(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const fieldId = useId();

  const run = async (slip: Slip, fromFixtureData = false) => {
    setError(null);
    setChecking(true);
    setVerdict(null);
    setCurrent(slip);
    setFromFixtures(fromFixtureData);
    const v = await verifySlip(slip);
    setVerdict(v);
    setChecking(false);
  };

  const readChain = async () => {
    if (!current) return;
    setReading(true);
    setVerdict(await verifySlip(current, { readChain: true }));
    setReading(false);
  };

  const check = (raw: string) => {
    const parsed = parseSlip(raw);
    if ("error" in parsed) {
      setVerdict(null);
      setError(parsed.error);
      return;
    }
    // Re-checking the slip already loaded keeps its provenance; anything else is pasted.
    const fromFixtureData = fromFixtures && current?.hash === parsed.slip.hash;
    void run(parsed.slip, fromFixtureData);
  };

  const load = (slip: Slip, note: string | null, fromFixtureData = false) => {
    const raw = JSON.stringify(slip, null, 2);
    setText(raw);
    setNotice(note);
    void run(slip, fromFixtureData);
  };

  useEffect(() => {
    if (!hash) return;
    api.slip(hash).then(
      (r) => {
        const fromFixtureData = r.source === "fixtures";
        if (r.data) {
          load(r.data.slip, fromFixtureData ? "Loaded from fixture data." : "Loaded from the hub, then checked here.", fromFixtureData);
        } else setError("No slip with that hash. Paste the slip itself; checking it never needs the hub.");
      },
      () => setError("The hub did not answer. Paste the slip itself; checking it never needs the hub."),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hash]);

  /*
   * Something real to check when no slip is to hand: the newest slip this hub minted. Only under
   * ?hub=off does it come from the fixtures, which load on demand and never ship in the default bundle.
   */
  const [example, setExample] = useState<{ slip: Slip; note: string; fromFixtures: boolean } | null>(null);
  useEffect(() => {
    let alive = true;
    void (async () => {
      const rows = await api.settlements(10).catch(() => null);
      if (rows?.source === "fixtures") {
        const fx = await import("../../fixtures/index.ts");
        const slip = fx.slips.find((x) => x.slip.payment.accepted.scheme === "countersign")?.slip;
        if (alive && slip) setExample({ slip, note: "A signed example from the fixtures.", fromFixtures: true });
        return;
      }
      const hash = rows?.data?.find((x) => x.slipHash)?.slipHash;
      if (!hash) return;
      const view = await api.slip(hash).catch(() => null);
      if (alive && view?.data) {
        setExample({ slip: view.data.slip, note: "The newest slip on this hub, checked here from its own bytes.", fromFixtures: false });
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="page">
      <header className="page__head">
        <p className="page__eyebrow">Verify</p>
        <h1 className="page__title">Check a slip without asking anyone.</h1>
        <p className="page__lede">
          Paste a slip or open the file. This page recomputes its hash and recovers both signatures in your browser, with
          no hub and no account. It asks the chain only when you press Check the chain.
        </p>
      </header>

      <div className="page__split verify">
        <form
          className="verify__form"
          onSubmit={(e) => {
            e.preventDefault();
            check(text);
          }}
        >
          <label htmlFor={fieldId} className="verify__label">
            Slip JSON
          </label>
          <textarea
            id={fieldId}
            className="verify__input mono"
            value={text}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            placeholder={'{ "body": { … }, "hash": "0x…", "sellerSig": "0x…", "payment": { … }, "settlement": { … } }'}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${fieldId}-error` : undefined}
            onChange={(e) => {
              setText(e.target.value);
              setNotice(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                check(text);
              }
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              const f = e.dataTransfer.files[0];
              if (!f) return;
              e.preventDefault();
              void f.text().then((t) => {
                setText(t);
                check(t);
              });
            }}
          />
          {error ? (
            <p id={`${fieldId}-error`} className="verify__error" role="alert">
              {error}
            </p>
          ) : null}
          {notice ? <p className="verify__notice">{notice}</p> : null}
          <div className="button-row">
            <Button variant="primary" type="submit" disabled={!text.trim() || checking}>
              {checking ? "Checking" : "Verify"}
            </Button>
            <Button variant="secondary" onClick={() => file.current?.click()}>
              Open a file
            </Button>
            <input
              ref={file}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                void f.text().then((t) => {
                  setText(t);
                  setNotice(`Opened ${f.name}.`);
                  check(t);
                });
                e.target.value = "";
              }}
            />
          </div>
          {example ? (
            <p className="verify__examples">
              No slip to hand?{" "}
              <button type="button" className="link-button" onClick={() => load(example.slip, example.note, example.fromFixtures)}>
                Load the newest slip on this hub
              </button>{" "}
              or{" "}
              <button
                type="button"
                className="link-button"
                onClick={() => {
                  const tampered = structuredClone(example.slip);
                  tampered.body.amount = (BigInt(tampered.body.amount) * 2n).toString();
                  load(tampered, "The same slip with its amount doubled after signing.", example.fromFixtures);
                }}
              >
                one with a changed amount
              </button>
              .
            </p>
          ) : null}
        </form>

        <aside className="page__rail" aria-label="Result">
          {verdict || checking ? (
            <Verdict
              verdict={verdict}
              chain={
                current
                  ? {
                      can: canReadChain(current),
                      busy: reading,
                      onRead: () => void readChain(),
                      explorer: explorerFor(current, fromFixtures),
                    }
                  : undefined
              }
            />
          ) : (
            <div className="verify__idle">
              <p className="verify__idle-title">What gets checked</p>
              <ol className="verify__steps">
                <li>The slip hash is the keccak-256 of its body in canonical JSON, so no field can change.</li>
                <li>The seller signed Release over that hash. On escrow rails it is the same signature the contract checked.</li>
                <li>The buyer’s one countersignature binds this offer hash and this amount.</li>
                <li>
                  The settlement is not taken on trust. Press Check the chain to read the escrow’s Released event for this
                  job and slip from a public RPC.
                </li>
              </ol>
              <p className="section__note">
                A slip from a call opens here too: follow <span className="mono">/verify/&lt;slip hash&gt;</span>, or
                use <Link to="/buyer?tab=history">the buyer’s history</Link>.
              </p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
