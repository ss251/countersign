import { useContext } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { WalletModeContext } from "../../app/Providers.tsx";
import type { PageProps } from "../../app/routes.ts";
import { FOREIGN_HUB, isOwnHub } from "../../lib/hub.ts";
import "../../ui/page.css";
import { readCode } from "./approve.ts";
import { CliLoginView, type CliSignIn } from "./View.tsx";

export const surface = "desk";

const EMAIL_OFF = "Email sign-in is off on this console, so it cannot connect a CLI.";

export default function CliLoginPage({ query }: PageProps) {
  const code = readCode(query);
  const privy = useContext(WalletModeContext).privy;
  const own = isOwnHub();
  if (privy && own) return <PrivyConnect code={code} />;
  return <CliLoginView code={code} signIn={null} reason={privy ? FOREIGN_HUB : EMAIL_OFF} />;
}

/** The only component on this page that touches Privy; the view stays renderable without it. */
function PrivyConnect({ code }: { code: string | null }) {
  const { ready, authenticated, login, getAccessToken } = usePrivy();
  const signIn: CliSignIn = { ready, authenticated, login, getAccessToken };
  return <CliLoginView code={code} signIn={signIn} />;
}
