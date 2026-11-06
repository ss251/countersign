import type { PageProps } from "../../app/routes.ts";
import { api, useResource } from "../../lib/api.ts";
import { Assistant } from "./Assistant.tsx";
import "../../ui/page.css";

/** The assistant on a desk: what you asked on the left, what fits on the right. The phone has it as Ask. */
export default function AssistantPage(_props: PageProps) {
  const envelope = useResource(() => api.envelope(), []);
  return (
    <div className="page">
      <Assistant envelope={envelope} layout="desk" />
    </div>
  );
}
