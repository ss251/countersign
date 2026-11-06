/**
 * The onboarding guide's quickstarts, read as blocks. Pure: no React, no Vite, no HTML.
 * The console supplies the titles; the guide supplies only the text between its markers.
 */

export type SectionId = "hire" | "list" | "charge";

export type Block =
  | { kind: "p"; text: string }
  | { kind: "li"; text: string }
  | { kind: "code"; text: string; lang: string };

export function section(markdown: string | null, id: SectionId): Block[] | null {
  if (markdown === null) return null;

  const open = `<!-- get-started:${id} -->`;
  const close = `<!-- /get-started:${id} -->`;
  const start = markdown.indexOf(open);
  const end = markdown.indexOf(close);
  if (start < 0 || end < 0 || end < start) return null;

  const lines = markdown.slice(start + open.length, end).split(/\r?\n/);
  const blocks: Block[] = [];
  let paragraph: string[] = [];

  const flush = () => {
    if (paragraph.length === 0) return;
    blocks.push({ kind: "p", text: paragraph.join(" ") });
    paragraph = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";

    if (line.startsWith("```")) {
      flush();
      const lang = line.slice(3).trim() || "text";
      const body: string[] = [];
      let closed = false;
      for (i++; i < lines.length; i++) {
        const next = lines[i] ?? "";
        if (next === "```") {
          closed = true;
          break;
        }
        body.push(next);
      }
      if (!closed) return null;
      blocks.push({ kind: "code", text: body.join("\n"), lang });
      continue;
    }

    if (line.startsWith("- ")) {
      flush();
      blocks.push({ kind: "li", text: line.slice(2).trim() });
      continue;
    }

    if (/^#+ /.test(line)) continue;

    if (line.startsWith("<!--")) continue;

    if (line.trim() === "") {
      flush();
      continue;
    }

    paragraph.push(line.trim());
  }

  flush();
  return blocks;
}

export type Inline = { kind: "text"; text: string } | { kind: "code"; text: string } | { kind: "link"; text: string; href: string };

const TOKEN = /`([^`]*)`|\[([^\]]*)\]\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g;

export function inline(text: string): Inline[] {
  const parts: Inline[] = [];
  let last = 0;

  for (const match of text.matchAll(TOKEN)) {
    if (match.index > last) parts.push({ kind: "text", text: text.slice(last, match.index) });

    if (match[1] !== undefined) {
      parts.push({ kind: "code", text: match[1] });
    } else {
      const label = match[2] ?? "";
      const href = match[3] ?? "";
      if (href.startsWith("http://") || href.startsWith("https://")) {
        parts.push({ kind: "link", text: label, href });
      } else {
        parts.push({ kind: "text", text: label });
      }
    }

    last = match.index + match[0].length;
  }

  if (last < text.length) parts.push({ kind: "text", text: text.slice(last) });
  return parts;
}
