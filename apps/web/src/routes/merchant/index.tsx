import type { PageProps } from "../../app/routes.ts";
import { Desk } from "./Desk.tsx";
import { Receipt } from "./Receipt.tsx";
import "./merchant.css";

export default function MerchantPage({ params, query }: PageProps) {
  const fixture = query.get("fixture") === "1";
  if (params[0] === "receipt") {
    return <Receipt id={params[1] ?? ""} fixture={fixture} />;
  }
  return <Desk fixture={fixture} />;
}
