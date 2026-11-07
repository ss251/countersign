/**
 * The skill adapter: serve a real SKILL.md as guidance text.
 *
 * Front matter is parsed by hand (simple `key: value` lines between the first
 * two `---` lines), with block scalars `key: >` and `key: |`, so no YAML
 * dependency is needed.
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { JsonSchema, Offer, RailId } from "@countersign/core";
import type { Address } from "./account.ts";

export interface Skill {
  name: string;
  description: string;
  body: string;
  sha256: string;
}

export interface SkillInput {
  question?: string;
  section?: string;
}

export interface SkillOutput {
  name: string;
  text: string;
  sha256: string;
}

export interface SkillOfferArgs {
  seller: Address;
  skill: Skill;
  price: string;
  deadline: number;
  rails: RailId[];
  payTo?: Partial<Record<RailId, string>>;
  upstream?: { url: string; licence: string };
  /** The seller's ENS name on Sepolia; it must resolve to `seller`. */
  ens?: string | undefined;
  now: number;
}

export const SKILL_INPUT_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    question: { type: "string", maxLength: 2000 },
    section: { type: "string", maxLength: 200 },
  },
  additionalProperties: false,
};

export const SKILL_OUTPUT_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    name: { type: "string" },
    text: { type: "string" },
    sha256: { type: "string", pattern: "^[0-9a-f]{64}$" },
  },
  required: ["name", "text", "sha256"],
  additionalProperties: false,
};

const FRONT_MATTER = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
const HEADING = /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*\r?$/gm;

/** Read a SKILL.md, parse its front matter and hash the file bytes. */
export async function readSkill(path: string): Promise<Skill> {
  const bytes = new Uint8Array(await readFile(path));
  const text = new TextDecoder().decode(bytes);
  const match = FRONT_MATTER.exec(text);
  if (!match) throw new Error("The skill must start with front matter between two --- lines.");
  const fields = parseFrontMatter(match[1] ?? "");
  const name = fields.get("name");
  const description = fields.get("description");
  if (!name) throw new Error("The skill front matter needs a name.");
  if (!description) throw new Error("The skill front matter needs a description.");
  return {
    name,
    description,
    body: text.slice(match[0].length).replace(/^\r?\n/, ""),
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

/** Return the whole body, or the one section whose heading text matches. */
export function runSkill(skill: Skill, input: SkillInput): SkillOutput {
  if (input.section === undefined) {
    return { name: skill.name, text: skill.body, sha256: skill.sha256 };
  }
  const text = findSection(skill.body, input.section);
  if (text === undefined) throw new Error(`The skill has no section named ${input.section}.`);
  return { name: skill.name, text, sha256: skill.sha256 };
}

/** Build the offer a seller publishes for a skill. */
export function skillOffer(args: SkillOfferArgs): Offer {
  const offer: Offer = {
    v: 1,
    seller: args.seller,
    title: args.skill.name,
    summary: args.skill.description.slice(0, 2000),
    adapter: "skill",
    input: SKILL_INPUT_SCHEMA,
    output: SKILL_OUTPUT_SCHEMA,
    price: args.price,
    deadline: args.deadline,
    bond: "0",
    rails: args.rails,
    issuedAt: args.now,
  };
  if (args.payTo !== undefined && Object.keys(args.payTo).length > 0) offer.payTo = args.payTo;
  if (args.upstream !== undefined) offer.upstream = args.upstream;
  if (args.ens !== undefined) offer.ens = args.ens;
  return offer;
}

function parseFrontMatter(raw: string): Map<string, string> {
  const fields = new Map<string, string>();
  const lines = raw.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    // Indented lines belong to the key above, unless that key opened a block scalar.
    if (/^[ \t]/.test(line)) continue;
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const key = line.slice(0, colon).trim();
    const rawValue = line.slice(colon + 1).trim();
    const block = /^([>|])([+-]?)$/.exec(rawValue);
    if (block) {
      const collected: string[] = [];
      let j = i + 1;
      for (; j < lines.length; j += 1) {
        const next = lines[j] ?? "";
        if (next.trim() === "") {
          collected.push("");
          continue;
        }
        if (!/^[ \t]/.test(next)) break;
        collected.push(next);
      }
      i = j - 1;
      fields.set(key, blockScalar(collected, block[1] === ">"));
      continue;
    }
    fields.set(key, unquote(rawValue));
  }
  return fields;
}

/** Strip one level of matching quotes from a plain scalar. */
function unquote(value: string): string {
  if (value.length < 2) return value;
  const first = value[0];
  const last = value[value.length - 1];
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return value.slice(1, -1);
  }
  return value;
}

/**
 * Read an indented block scalar. Literal keeps its line breaks; folded turns
 * single line breaks into spaces and blank lines into newlines.
 */
function blockScalar(lines: string[], folded: boolean): string {
  let indent = Number.POSITIVE_INFINITY;
  for (const line of lines) {
    if (line.trim() === "") continue;
    const leading = /^[ \t]*/.exec(line)?.[0].length ?? 0;
    indent = Math.min(indent, leading);
  }
  const strip = Number.isFinite(indent) ? indent : 0;
  const content = lines.map((line) => (line.trim() === "" ? "" : line.slice(strip)));
  while (content.length > 0 && content[0] === "") content.shift();
  while (content.length > 0 && content[content.length - 1] === "") content.pop();
  if (!folded) return content.join("\n");
  const paragraphs: string[] = [];
  let current: string[] = [];
  for (const line of content) {
    if (line === "") {
      if (current.length > 0) {
        paragraphs.push(current.join(" "));
        current = [];
      }
      continue;
    }
    current.push(line.trim());
  }
  if (current.length > 0) paragraphs.push(current.join(" "));
  return paragraphs.join("\n");
}

function findSection(body: string, wanted: string): string | undefined {
  const target = wanted.trim().toLowerCase();
  const headings = [...body.matchAll(HEADING)].map((match) => ({
    level: match[1]?.length ?? 0,
    text: (match[2] ?? "").trim(),
    start: match.index ?? 0,
  }));
  const index = headings.findIndex((heading) => heading.text.toLowerCase() === target);
  if (index === -1) return undefined;
  const heading = headings[index]!;
  const next = headings.slice(index + 1).find((candidate) => candidate.level <= heading.level);
  const end = next?.start ?? body.length;
  return body.slice(heading.start, end).trimEnd();
}
