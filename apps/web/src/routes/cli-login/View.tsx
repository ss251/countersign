import { useCallback, useEffect, useState } from "react";
import { FOREIGN_HUB, hubPost, isOwnHub } from "../../lib/hub.ts";
import { Button, Hash } from "../../ui/primitives.tsx";
import { approveCliLogin, type ApproveOutcome } from "./approve.ts";

/** What the view needs from Privy, so tests can render it without the provider. */
export interface CliSignIn {
  ready: boolean;
  authenticated: boolean;
  login: () => void;
  getAccessToken: () => Promise<string | null>;
}

const EMAIL_OFF = "Email sign-in is off on this console, so it cannot connect a CLI.";
const SIGN_IN_AGAIN = "Sign in again, then connect.";

function outcomeMessage(outcome: ApproveOutcome): string {
  switch (outcome.kind) {
    case "approved":
      return "Connected. Go back to your terminal; it finishes there.";
    case "signed-out":
      return SIGN_IN_AGAIN;
    case "expired":
      return "This code has expired. Run countersign login again.";
    case "error":
      return outcome.message;
  }
}

export function CliLoginView({
  code,
  signIn,
  reason = isOwnHub() ? EMAIL_OFF : FOREIGN_HUB,
}: {
  code: string | null;
  signIn: CliSignIn | null;
  /** Why sign-in is unavailable, when it is. */
  reason?: string;
}) {
  const [pending, setPending] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [outcome, setOutcome] = useState<ApproveOutcome | null>(null);

  const send = useCallback(async () => {
    if (!signIn || !code) return;
    setConnecting(true);
    try {
      const privyToken = await signIn.getAccessToken();
      if (!privyToken) {
        setOutcome({ kind: "signed-out" });
        return;
      }
      setOutcome(await approveCliLogin({ post: hubPost, privyToken, code }));
    } catch {
      setOutcome({ kind: "error", message: "The hub could not connect this CLI." });
    } finally {
      setConnecting(false);
    }
  }, [code, signIn]);

  useEffect(() => {
    if (!pending || !signIn?.authenticated) return;
    setPending(false);
    void send();
  }, [pending, signIn, send]);

  const approved = outcome?.kind === "approved" ? outcome : null;

  return (
    <div className="page">
      <header className="page__head">
        <h1 className="page__title">Connect your CLI</h1>
      </header>

      {code === null ? (
        <p className="field__error" role="alert">
          This page needs the code your terminal printed. Run countersign login again.
        </p>
      ) : (
        <>
          <p className="page__lede">Check that this code matches the one in your terminal.</p>
          <p className="mono" data-testid="cli-code">
            {code}
          </p>
          <p className="field__hint">
            Never approve a code you did not start yourself: whoever started it gets your agent wallet's session.
          </p>

          {signIn === null ? (
            <p className="locked__alt">{reason}</p>
          ) : approved ? (
            <>
              <p role="status">Connected. Go back to your terminal; it finishes there.</p>
              {approved.address ? (
                <p>
                  Your agent wallet: <Hash value={approved.address} label="agent wallet address" />
                </p>
              ) : null}
            </>
          ) : (
            <>
              {outcome ? (
                <p className="field__error" role="alert">
                  {outcomeMessage(outcome)}
                </p>
              ) : null}
              <Button
                variant="primary"
                block
                disabled={connecting || !signIn.ready}
                onClick={() => {
                  if (!signIn.ready) return;
                  if (!signIn.authenticated) {
                    setPending(true);
                    signIn.login();
                    return;
                  }
                  void send();
                }}
              >
                {connecting ? "Connecting…" : "Connect this CLI"}
              </Button>
            </>
          )}
        </>
      )}
    </div>
  );
}
