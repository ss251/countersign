import type { PageProps } from "../../app/routes.ts";
import { Desk } from "./Desk.tsx";
import { Receipt } from "./Receipt.tsx";
import "./merchant.css";

/** The customer's receipt stands alone on a phone; the merchant desk keeps the app around it. */
export const surface = (params: string[]) => (params[0] === "receipt" ? "bare" : "desk");

export default function MerchantPage({ params, query }: PageProps) {
  const fixture = query.get("fixture") === "1";
  if (params[0] === "receipt") {
    return <Receipt id={params[1] ?? ""} fixture={fixture} />;
  }
  return <Desk fixture={fixture} merchantQuery={query.get("merchant")} />;
}
