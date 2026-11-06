import type { PageProps } from "../../app/routes.ts";
import { Desk } from "./Desk.tsx";
import { Receipt } from "./Receipt.tsx";
import "./merchant.css";

/** The customer's receipt stands alone on a phone; the merchant desk keeps the app around it. */
export const surface = (params: string[]) => (params[0] === "receipt" ? "bare" : "desk");

export default function MerchantPage({ params, query }: PageProps) {
  // Live by default. Only ?hub=off shows the sample ledger, loaded on demand (STEER-1730).
  const offline = query.get("hub") === "off";
  if (params[0] === "receipt") {
    return <Receipt id={params[1] ?? ""} offline={offline} />;
  }
  return <Desk offline={offline} merchantQuery={query.get("merchant")} />;
}
