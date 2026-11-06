import { useCallback, useEffect, useState } from "react";
import { FOREIGN_HUB, hubPost, isOwnHub } from "../../lib/hub.ts";
import { Button, Hash } from "../../ui/primitives.tsx";
import { approveCliLogin, type ApproveOutcome } from "./approve.ts";

/** What the view needs from Privy, so tests can render it without the provider. */
export interface CliSignIn {
  ready: boolean;
  authenticated: boolean;
  /** Opens Privy sign-in; resolves true only when that sign-in authenticated. */
  login: () => Promise<boolean> | undefined;
  getAccessToken: () => Promise<string | null>;
}

/** Where the sign-in this page opened stands. */
export type LoginPhase = "idle" | "pending" | "completed";

/** The sign-in settled: a dismissal clears the wait, and only a completion may approve. */
export function loginSettled(completed: boolean | undefined): LoginPhase {
  return completed === true ? "completed" : "idle";
}

/** Claim this page's own completed sign-in once; a later sign-in from elsewhere gets nothing. */
export function claimApproval(
  phase: LoginPhase,
  authenticated: boolean,
): { phase: LoginPhase; approve: boolean } {
  if (phase !== "completed" || !authenticated) return { phase, approve: false };
  return { phase: "idle", approve: true };
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
  const [phase, setPhase] = useState<LoginPhase>("idle");
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

  const startLogin = useCallback(async () => {
    if (!signIn) return;
    setPhase("pending");
    setPhase(loginSettled(await signIn.login()));
  }, [signIn]);

  useEffect(() => {
    const step = claimApproval(phase, signIn?.authenticated ?? false);
    if (!step.approve) return;
    setPhase(step.phase);
    void send();
  }, [phase, signIn, send]);

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
          <p className="field__hint">If you did not just run countersign login yourself, close this page.</p>

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
                    void startLogin();
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
