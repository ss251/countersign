import type { PageProps } from "../../app/routes.ts";
import BuyerPage from "../buyer/index.tsx";

/** The assistant is the buyer's phone opened on Ask: asking, the envelope and the countersign are one person's flow. */
export default function AssistantPage({ params, query }: PageProps) {
  const q = new URLSearchParams(query);
  if (!q.get("tab")) q.set("tab", "ask");
  return <BuyerPage params={params} query={q} />;
}
