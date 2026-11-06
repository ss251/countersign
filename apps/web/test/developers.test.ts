import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { inline, section, type SectionId } from "../src/routes/developers/blocks.ts";
import { DevelopersView, KEY_NOTE } from "../src/routes/developers/View.tsx";

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

    expect(headings(html)).toEqual(TITLES);
    expect(copyButtons(html)).toBe(3);
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

    expect(headings(html)).toEqual(TITLES);
    expect(copyButtons(html)).toBe(0);
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
    expect((html.match(/class="command__head"/g) ?? []).length).toBe(codeBlocks.length);
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
