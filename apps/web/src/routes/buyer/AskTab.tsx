import type { Resource } from "../../lib/api.ts";
import type { EnvelopeView } from "../../lib/types.ts";
import { Assistant } from "../assistant/Assistant.tsx";

/** Ask, on the phone: the same assistant, one column, the input pinned above the tab bar. */
export function AskTab({ envelope }: { envelope: Resource<EnvelopeView | null> }) {
  return <Assistant envelope={envelope} layout="phone" />;
}
