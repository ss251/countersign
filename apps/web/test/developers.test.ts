import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { inline, section, type SectionId } from "../src/routes/developers/blocks.ts";
import { DevelopersView, KEY_NOTE } from "../src/routes/developers/View.tsx";
import {
  CLIENTS,
  CURSOR_RULE,
  LIMITS,
  LOGIN,
  RULES,
  SERVER,
  agentsMarkdown,
  type ClientId,
} from "../src/routes/developers/agents.ts";
import { ClientMark } from "../src/routes/developers/marks.tsx";

const FIXTURE = `Read this before the markers and never on the screen.

<!-- get-started:hire -->
## Hire a tool

Start with a need and \`countersign find\` on one
line, then open [the registry](https://example.com/registry).

- Pick a tool that does the work.
- Pay inside limits you sign.

\`\`\`json
{ "need": "summarize", "budget": "0.05" }
\`\`\`
<!-- /get-started:hire -->

<!-- get-started:list -->
List your server so an agent can find it, not [here](javascript:alert(1)).

\`\`\`bash
countersign list --offer ./offer.json
\`\`\`
<!-- /get-started:list -->

<!-- get-started:charge -->
Charge for your API by the call.

\`\`\`bash
countersign charge --price 0.05
\`\`\`
<!-- /get-started:charge -->

Text after the markers, also never on the screen.
`;

const IDS: SectionId[] = ["hire", "list", "charge"];
const TITLES = ["Hire from Claude or Cursor", "Sell your API", "Charge in USDT"];

function headings(html: string): string[] {
  return [...html.matchAll(/<h2[^>]*class="gs__title"[^>]*>([^<]*)<\/h2>/g)].map((m) => m[1] ?? "");
}

function copyButtons(html: string): number {
  return [...html.matchAll(/class="copy"/g)].length;
}

/**
 * The guide's three sections, from the first one on. Evidence line (STEER-0625, the captain's ask): "Use it from
 * your agent" now sits above them with its own heading and Copy buttons, so the counts below, which are about the
 * guide's sections, read from dev-hire on. What they assert is unchanged.
 */
function guidePart(html: string): string {
  const at = html.indexOf('data-testid="dev-hire"');
  return at === -1 ? html : html.slice(html.lastIndexOf("<section", at));
}

describe("section", () => {
  test("reads a marked quickstart and nothing outside it", () => {
    expect(section(FIXTURE, "hire")).toEqual([
      {
        kind: "p",
        text: "Start with a need and `countersign find` on one line, then open [the registry](https://example.com/registry).",
      },
      { kind: "li", text: "Pick a tool that does the work." },
      { kind: "li", text: "Pay inside limits you sign." },
      { kind: "code", text: '{ "need": "summarize", "budget": "0.05" }', lang: "json" },
    ]);
    expect(JSON.stringify(section(FIXTURE, "hire"))).not.toContain("Read this before");
    expect(JSON.stringify(section(FIXTURE, "hire"))).not.toContain("Text after the markers");
  });

  test("a missing opening marker is null", () => {
    expect(section("<!-- /get-started:hire -->\ntext\n", "hire")).toBeNull();
  });

  test("a missing closing marker is null", () => {
    expect(section("<!-- get-started:hire -->\ntext\n", "hire")).toBeNull();
  });

  test("a closing marker before the opening one is null", () => {
    expect(section("<!-- /get-started:hire -->\ntext\n<!-- get-started:hire -->", "hire")).toBeNull();
  });

  test("an unclosed fence makes the whole section null", () => {
    expect(section("<!-- get-started:hire -->\n```bash\necho hi\n<!-- /get-started:hire -->", "hire")).toBeNull();
  });

  test("a missing guide is null", () => {
    expect(section(null, "hire")).toBeNull();
  });
});

describe("inline", () => {
  test("splits code spans and http(s) links", () => {
    expect(inline("Run `bun install` then [read](https://example.com/guide).")).toEqual([
      { kind: "text", text: "Run " },
      { kind: "code", text: "bun install" },
      { kind: "text", text: " then " },
      { kind: "link", text: "read", href: "https://example.com/guide" },
      { kind: "text", text: "." },
    ]);
    expect(inline("[spec](http://example.com/spec)")).toEqual([
      { kind: "link", text: "spec", href: "http://example.com/spec" },
    ]);
  });

  test("a link that is not http(s) keeps only its text", () => {
    expect(inline("[bad](javascript:alert(1)) and [local](/docs)")).toEqual([
      { kind: "text", text: "bad" },
      { kind: "text", text: " and " },
      { kind: "text", text: "local" },
    ]);
  });

  test("plain text is one text part", () => {
    expect(inline("nothing to split")).toEqual([{ kind: "text", text: "nothing to split" }]);
  });
});

describe("DevelopersView", () => {
  test("renders the three sections in order, with a copy button per code block", () => {
    const html = renderToString(createElement(DevelopersView, { markdown: FIXTURE }));

    expect(headings(guidePart(html))).toEqual(TITLES);
    expect(copyButtons(guidePart(html))).toBe(3);
    expect(html).toContain('aria-label="Copy Hire from Claude or Cursor json"');
    expect(html).toContain("summarize");
    expect(html).toContain("./offer.json");
    expect(html).toContain("countersign charge --price 0.05");
    expect(html).toContain("<code class=\"mono\">countersign find</code>");
    expect(html).toContain('href="https://example.com/registry"');
    expect(html).toContain('data-testid="dev-hire"');
    expect(html).toContain('data-testid="dev-list"');
    expect(html).toContain('data-testid="dev-charge"');
    expect(html).not.toContain("<script");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("Read this before");
  });

  test("without a guide, every section says so and keeps its title", () => {
    const html = renderToString(createElement(DevelopersView, { markdown: null }));

    expect(headings(guidePart(html))).toEqual(TITLES);
    expect(copyButtons(guidePart(html))).toBe(0);
    for (const id of IDS) expect(html).toContain(`data-testid="dev-pending-${id}"`);
    expect(html).toContain("This part of the guide is being written in docs/onboarding.md.");
  });
});

const guideFile = Bun.file(new URL("../../../docs/onboarding.md", import.meta.url));
const hasGuide = await guideFile.exists();

test.skipIf(!hasGuide)("every marker in the real guide parses", async () => {
  const markdown = await guideFile.text();
  for (const id of IDS) {
    const open = `<!-- get-started:${id} -->`;
    const close = `<!-- /get-started:${id} -->`;
    if (!markdown.includes(open) && !markdown.includes(close)) continue;
    expect(section(markdown, id)).not.toBeNull();
  }
});

describe("the developer surface, from the real guide (STEER-0440)", () => {
  const read = (rel: string) => Bun.file(new URL(rel, import.meta.url).pathname).text();
  const plain = (html: string) =>
    html
      .replace(/<[^>]*>/g, "")
      .replace(/&quot;/g, '"')
      .replace(/&#x27;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&");

  test("the three paths carry the guide's own commands: login, the MCP config, sell openapi, and the relay", async () => {
    const md = await read("../../../docs/onboarding.md");
    const text = plain(renderToString(createElement(DevelopersView, { markdown: md })));
    for (const title of ["Hire from Claude or Cursor", "Sell your API", "Charge in USDT"]) expect(text).toContain(title);
    expect(text).toContain("npx -y @countersign-hub/cli login");
    expect(text).toMatch(/"command":\s*"npx"/);
    expect(text).toMatch(/"args":\s*\[\s*"-y",\s*"@countersign-hub\/cli",\s*"mcp"\s*\]/);
    expect(text).toContain("npx -y @countersign-hub/cli sell openapi");
    expect(text).toContain("npm i @countersign-hub/relay");
  });

  test("every code block in the three paths has its own Copy button", async () => {
    const md = await read("../../../docs/onboarding.md");
    const codeBlocks = (["hire", "list", "charge"] as const).flatMap((id) => (section(md, id) ?? []).filter((b) => b.kind === "code"));
    expect(codeBlocks.length).toBeGreaterThanOrEqual(3);
    const html = renderToString(createElement(DevelopersView, { markdown: md }));
    expect((guidePart(html).match(/class="command__head"/g) ?? []).length).toBe(codeBlocks.length);
  });

  test("the note says where the key lives, and nothing on the page asks for or names a private key", async () => {
    const md = await read("../../../docs/onboarding.md");
    const text = plain(renderToString(createElement(DevelopersView, { markdown: md })));
    expect(text).toContain(KEY_NOTE);
    expect(KEY_NOTE).toContain("Privy server wallet");
    expect(text).not.toMatch(/private.?key|_KEY\b|mnemonic|seed phrase|paste (your|a) key/i);
  });

  test("the page joins Rajdeep's bar under Sell, as Developers", async () => {
    const routes = await read("../src/app/routes.ts");
    expect(routes).toContain('{ name: "developers", label: "Developers", ready: true, group: "sell" }');
  });
});

describe("Use it from your agent (STEER-0625)", () => {
  const file = (rel: string) => Bun.file(new URL(rel, import.meta.url).pathname);
  const unescape = (text: string) =>
    text
      .replace(/&quot;/g, '"')
      .replace(/&#x27;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&");
  const plain = (html: string) => unescape(html.replace(/<[^>]*>/g, ""));
  const page = () => renderToString(createElement(DevelopersView, { markdown: FIXTURE }));
  const IDS: ClientId[] = ["claude", "cursor", "codex"];

  /** One client's panel: from its opening tag to the next panel, or to the section's foot. */
  const panel = (html: string, id: ClientId) => {
    const start = html.indexOf(`data-testid="agent-${id}"`);
    const from = html.lastIndexOf("<div", start);
    const next = html.indexOf('role="tabpanel"', start);
    const end = next === -1 ? html.indexOf('class="gs__foot"', start) : html.lastIndexOf("<div", next);
    return html.slice(from, end);
  };
  const blocks = (html: string) => [...html.matchAll(/<pre class="command__body mono">([\s\S]*?)<\/pre>/g)].map((m) => unescape(m[1] ?? ""));

  test("it sits right under the intro, with Claude, Cursor and Codex tabs, each with its mark, Claude open first", () => {
    const html = page();
    const at = html.indexOf('data-testid="dev-agents"');
    expect(at).toBeGreaterThan(html.indexOf('data-testid="dev-key-note"'));
    expect(at).toBeLessThan(html.indexOf('data-testid="dev-hire"'));
    expect(plain(html)).toContain("Use it from your agent");

    const tabs = [...html.matchAll(/<button[^>]*role="tab"[^>]*>([\s\S]*?)<\/button>/g)].map((m) => plain(m[1] ?? ""));
    expect(tabs).toEqual(["Claude", "Cursor", "Codex"]);
    for (const id of IDS) {
      expect(html).toContain(`data-testid="agent-tab-${id}"`);
      expect(html).toContain(`data-mark="${id}"`);
      expect(html).toContain(`aria-controls="agent-panel-${id}"`);
    }
    const panels = [...html.matchAll(/<div[^>]*role="tabpanel"[^>]*>/g)].map((m) => m[0]);
    expect(panels).toHaveLength(3);
    expect(panels[0]).toContain('data-testid="agent-claude"');
    expect(panels[0]).not.toContain("hidden");
    expect(panels[1]).toContain('hidden=""');
    expect(panels[2]).toContain('hidden=""');
    expect(html).toMatch(/aria-selected="true"[^>]*data-testid="agent-tab-claude"/);
  });

  test("each panel's blocks are the source constants, in order, each with its own Copy button", () => {
    const html = page();
    for (const client of CLIENTS) {
      const part = panel(html, client.id);
      const expected = [LOGIN, LIMITS, ...client.mcp.map((s) => s.text), client.rules.text];
      expect(blocks(part)).toEqual(expected);
      expect(copyButtons(part)).toBe(expected.length);
      for (const s of [...client.mcp, client.rules]) expect(plain(part)).toContain(s.where);
    }
    expect(CLIENTS.map((c) => c.rules.where)).toEqual(["CLAUDE.md", ".cursor/rules/countersign.mdc", "AGENTS.md"]);
    for (const label of ["the login command", "the Claude Code command", "Claude Desktop: claude_desktop_config.json", ".cursor/mcp.json", "the Codex CLI command", "~/.codex/config.toml", "AGENTS.md"]) {
      expect(html).toContain(`aria-label="Copy ${label}"`);
    }
  });

  test("every config starts the published server exactly as the guide's own MCP config does", async () => {
    const md = await file("../../../docs/onboarding.md").text();
    const guideJson = (section(md, "hire") ?? []).find((b) => b.kind === "code" && b.text.includes("mcpServers"));
    expect(guideJson).toBeDefined();
    const fromGuide = (JSON.parse(guideJson?.text ?? "{}") as { mcpServers: Record<string, unknown> }).mcpServers.countersign;
    expect(fromGuide).toEqual({ command: SERVER.command, args: [...SERVER.args] });

    const byWhere = (id: ClientId, where: string) => CLIENTS.find((c) => c.id === id)?.mcp.find((s) => s.where === where)?.text ?? "";
    const desktop = JSON.parse(byWhere("claude", "Claude Desktop: claude_desktop_config.json"));
    expect(desktop).toEqual({ mcpServers: { countersign: fromGuide } });
    const cursor = JSON.parse(byWhere("cursor", ".cursor/mcp.json"));
    expect(cursor).toEqual({ mcpServers: { countersign: { type: "stdio", ...(fromGuide as object) } } });
    const codex = Bun.TOML.parse(byWhere("codex", "~/.codex/config.toml")) as { mcp_servers: Record<string, unknown> };
    expect(codex).toEqual({ mcp_servers: { countersign: fromGuide } });

    expect(byWhere("claude", "Claude Code")).toBe("claude mcp add countersign -- npx -y @countersign-hub/cli mcp");
    expect(byWhere("codex", "Codex CLI")).toBe("codex mcp add countersign -- npx -y @countersign-hub/cli mcp");
    expect(LOGIN).toBe("npx -y @countersign-hub/cli login");
    expect(md).toContain(LOGIN);
    expect(md).toContain(LIMITS);
  });

  test("the rules name exactly the six tools the shipped MCP server registers, in the order a purchase uses them", async () => {
    const server = await file("../../../packages/mcp/src/server.ts").text();
    const registered = [...server.matchAll(/registerTool\(\s*"([a-z_]+)"/g)].map((m) => m[1] ?? "");
    const order = ["search_offers", "get_offer", "envelope_show", "buy", "verify_slip", "journal"];
    expect([...registered].sort()).toEqual([...order].sort());
    const firstUse = order.map((tool) => RULES.search(new RegExp(`\\b${tool}\\b`)));
    expect(firstUse.every((at) => at >= 0)).toBe(true);
    expect([...firstUse].sort((a, b) => a - b)).toEqual(firstUse);

    // What the rules say the tools answer is what the code answers.
    expect(server).toMatch(/"buy",[\s\S]*?offerHash: z\.string\(\),\s*input: z\.unknown\(\)/);
    expect(server).toContain("releaseTx: slip.settlement.transaction");
    expect(server).toContain("slipHash: slip.hash");
    expect(server).toMatch(/"verify_slip",[\s\S]*?slipHash: z\.string\(\)\.optional\(\)/);
    expect(server).toContain("online: entry.online");
    const buy = await file("../../../packages/buyer/src/buy.ts").text();
    expect(buy).toContain('"Held. This call is above your ask-above limit');
    expect(RULES).toContain('comes back "Held"');
    const signer = await file("../../../packages/buyer/src/remote-signer.ts").text();
    expect(signer).toContain(`"Not signed in. Run: ${LOGIN}"`);
    expect(RULES).toContain(`"Not signed in" means the user must run: ${LOGIN}`);
  });

  test("Cursor's rule is an .mdc with valid frontmatter: a description and alwaysApply false, then the same rules", () => {
    const match = CURSOR_RULE.match(/^---\n([\s\S]*?)\n---\n\n([\s\S]*)$/);
    expect(match).not.toBeNull();
    const front = Bun.YAML.parse(match?.[1] ?? "") as { description?: unknown; alwaysApply?: unknown };
    expect(typeof front.description).toBe("string");
    expect(String(front.description).length).toBeGreaterThan(20);
    expect(front.alwaysApply).toBe(false);
    expect(Object.keys(front).sort()).toEqual(["alwaysApply", "description"]);
    expect(match?.[2]).toBe(RULES);
  });

  test("/llms.txt and /agents.md are static files in public/, equal to agentsMarkdown(), ASCII only", async () => {
    const body = agentsMarkdown();
    for (const name of ["llms.txt", "agents.md"]) {
      const served = await file(`../public/${name}`).text();
      // Out of date? Run: bun apps/web/scripts/agents-md.ts
      expect(served).toBe(body);
    }
    expect(/^[\x00-\x7F]*$/.test(body)).toBe(true);
    for (const text of [LOGIN, LIMITS, RULES.trim(), CURSOR_RULE.trim(), ...CLIENTS.flatMap((c) => c.mcp.map((s) => s.text))]) {
      expect(body).toContain(text);
    }
  });

  test("the page points agents to /llms.txt, and nothing in the section or the markdown names a private key", () => {
    const html = page();
    expect(plain(html)).toContain("Agents can read this page as markdown: /llms.txt");
    expect(html).toContain('href="/llms.txt"');
    const words = /private.?key|_KEY\b|mnemonic|seed phrase|paste (your|a) key|partner|official/i;
    expect(plain(html)).not.toMatch(words);
    expect(agentsMarkdown()).not.toMatch(words);
  });

  test("each mark is one colour, the page's ink, and decorative beside its name", () => {
    for (const id of IDS) {
      const svg = renderToString(createElement(ClientMark, { id }));
      expect(svg).toMatch(/(fill|stroke)="currentColor"/);
      expect(svg).toContain('aria-hidden="true"');
      expect(svg).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(|oklch\(/i);
    }
  });
});
