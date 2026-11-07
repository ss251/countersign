/**
 * Writes /llms.txt and /agents.md (STEER-0625) from the same constants as the Developers page, so the three never
 * drift: bun apps/web/scripts/agents-md.ts. developers.test.ts fails when a file differs from agentsMarkdown().
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { agentsMarkdown } from "../src/routes/developers/agents.ts";

const body = agentsMarkdown();
for (const name of ["llms.txt", "agents.md"]) {
  writeFileSync(join(import.meta.dir, "..", "public", name), body);
  console.log(`wrote public/${name} (${body.length} bytes)`);
}
