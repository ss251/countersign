import type { PageProps } from "../../app/routes.ts";
import { api, useResource } from "../../lib/api.ts";
import { Assistant } from "./Assistant.tsx";
import "../../ui/page.css";

/**
 * The assistant on a desk: the palette on the left, the purchase card on the right. ?q= and ?pick=
 * restore a search and a chosen offer, which is how ⌘K on any other screen hands over to this one.
 */
export default function AssistantPage({ query }: PageProps) {
  const envelope = useResource(() => api.envelope(), []);
  const q = query.get("q") ?? "";
  const pick = query.get("pick") ?? undefined;
  return (
    <div className="page">
      <Assistant key={`${q}|${pick ?? ""}`} envelope={envelope} layout="page" initialQuery={q} initialPick={pick} />
    </div>
  );
}
