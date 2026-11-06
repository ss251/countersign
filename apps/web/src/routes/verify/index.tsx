import { useEffect, useId, useRef, useState } from "react";
import type { Slip } from "@countersign/core";
import type { PageProps } from "../../app/routes.ts";
import { Link } from "../../app/router.tsx";
import { api } from "../../lib/api.ts";
import { parseSlip, verifySlip, type Verdict as VerdictData } from "../../lib/verify.ts";
import * as fx from "../../fixtures/index.ts";
import { Verdict } from "../../ui/Verdict.tsx";
import { Button } from "../../ui/primitives.tsx";
import "../../ui/page.css";
import "./verify.css";

/**
 * Paste a slip, open a file, or arrive with a hash. The check runs here, from the slip's
 * own bytes, which is why it still answers when the hub is down.
 */
export default function VerifyPage({ params }: PageProps) {
  const hash = params[0];
  const [text, setText] = useState("");
  const [verdict, setVerdict] = useState<VerdictData | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const fieldId = useId();

  const run = async (slip: Slip) => {
    setError(null);
    setChecking(true);
    setVerdict(null);
    const v = await verifySlip(slip);
    setVerdict(v);
    setChecking(false);
  };

  const check = (raw: string) => {
    const parsed = parseSlip(raw);
    if ("error" in parsed) {
      setVerdict(null);
      setError(parsed.error);
      return;
    }
    void run(parsed.slip);
  };

  const load = (slip: Slip, note: string | null) => {
    const raw = JSON.stringify(slip, null, 2);
    setText(raw);
    setNotice(note);
    void run(slip);
  };

  useEffect(() => {
    if (!hash) return;
    api.slip(hash).then(
      (r) => {
        if (r.data) load(r.data.slip, r.source === "fixtures" ? "Loaded from fixture data." : "Loaded from the hub, then checked here.");
        else setError("No slip with that hash. Paste the slip itself; checking it never needs the hub.");
      },
      () => setError("The hub did not answer. Paste the slip itself; checking it never needs the hub."),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hash]);

  const example = fx.slips.find((s) => s.slip.payment.accepted.scheme === "countersign")?.slip;

  return (
    <div className="page">
      <header className="page__head">
        <p className="page__eyebrow">Verify</p>
        <h1 className="page__title">Check a slip without asking anyone.</h1>
        <p className="page__lede">
          Paste a slip or open the file. This page recomputes its hash and recovers both signatures in your browser. It
          sends nothing anywhere.
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
              <button type="button" className="link-button" onClick={() => load(example, "A signed example from the fixtures.")}>
                Load a signed example
              </button>{" "}
              or{" "}
              <button
                type="button"
                className="link-button"
                onClick={() => {
                  const tampered = structuredClone(example);
                  tampered.body.amount = (BigInt(tampered.body.amount) * 2n).toString();
                  load(tampered, "The same slip with its amount doubled after signing.");
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
            <Verdict verdict={verdict} />
          ) : (
            <div className="verify__idle">
              <p className="verify__idle-title">What gets checked</p>
              <ol className="verify__steps">
                <li>The slip hash is the keccak-256 of its body in canonical JSON, so no field can change.</li>
                <li>The seller signed Release over that hash. On escrow rails it is the same signature the contract checked.</li>
                <li>The buyer's one countersignature binds this offer hash and this amount.</li>
                <li>The settlement names the transaction that moved the money.</li>
              </ol>
              <p className="section__note">
                A slip from a call opens here too: follow <span className="mono">/verify/&lt;slip hash&gt;</span>, or
                use <Link to="/buyer?tab=history">the buyer's history</Link>.
              </p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
