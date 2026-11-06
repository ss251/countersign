/**
 * STEER-2225: the console must never look like a drainer. The built bundle may not carry an ERC-20
 * approve or increaseAllowance, an NFT setApprovalForAll, an EIP-2612 permit, or the eth_sign method,
 * either as a call our code makes (functionName) or as a function selector. Libraries may still name
 * them in prose (Privy's transaction view does), so this checks what could actually be sent, not words.
 *
 *   bun apps/web/scripts/wallet-grep.ts [dist]   exits 1 on any hit; apps/web/deploy.sh runs it before upload.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Function selectors: no code, ours or a library's, may carry one. */
export const SELECTORS: ReadonlyArray<{ name: string; pattern: RegExp }> = [
  { name: "approve(address,uint256) selector 0x095ea7b3", pattern: /095ea7b3/gi },
  { name: "increaseAllowance(address,uint256) selector 0x39509351", pattern: /39509351/gi },
  { name: "setApprovalForAll(address,bool) selector 0xa22cb465", pattern: /a22cb465/gi },
  { name: "EIP-2612 permit selector 0xd505accf", pattern: /d505accf/gi },
];

/**
 * Calls and methods our own code may never make. A wallet library may name them (Privy's embedded wallet
 * answers eth_sign; its transaction view decodes approvals), so each hit is traced through the source map
 * to the file it came from, and only hits from our sources (not node_modules) count.
 */
export const OURS: ReadonlyArray<{ name: string; pattern: RegExp }> = [
  {
    name: "a contract call to approve, increaseAllowance, permit or setApprovalForAll",
    pattern: /functionName\s*:\s*["'`](approve|increaseAllowance|permit|setApprovalForAll)["'`]/g,
  },
  { name: "the eth_sign method", pattern: /["'`]eth_sign["'`]/g },
  { name: "the personal_sign method", pattern: /["'`]personal_sign["'`]/g },
  { name: "the eth_requestAccounts method", pattern: /["'`]eth_requestAccounts["'`]/g },
];

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** One source map line's segments, as [generatedColumn, sourceIndex] with the running sums applied. */
function decodeLines(mappings: string): Array<Array<[number, number]>> {
  const lines: Array<Array<[number, number]>> = [];
  let source = 0;
  for (const line of mappings.split(";")) {
    let col = 0;
    const segs: Array<[number, number]> = [];
    for (const seg of line.split(",")) {
      if (!seg) continue;
      const fields: number[] = [];
      let value = 0;
      let shift = 0;
      for (const ch of seg) {
        const digit = B64.indexOf(ch);
        value += (digit & 31) << shift;
        if (digit & 32) {
          shift += 5;
        } else {
          fields.push(value & 1 ? -(value >>> 1) : value >>> 1);
          value = 0;
          shift = 0;
        }
      }
      col += fields[0] ?? 0;
      if (fields.length > 1) source += fields[1] ?? 0;
      segs.push([col, fields.length > 1 ? source : -1]);
    }
    lines.push(segs);
  }
  return lines;
}

export interface SourceMapLike {
  sources: string[];
  mappings: string;
}

/** The source file a position in the built file came from, or null when the map does not say. */
export function sourceAt(map: SourceMapLike, lines: Array<Array<[number, number]>>, line: number, column: number): string | null {
  const segs = lines[line];
  if (!segs) return null;
  let found = -1;
  for (const [col, src] of segs) {
    if (col > column) break;
    found = src;
  }
  return found >= 0 ? (map.sources[found] ?? null) : null;
}

export interface Hit {
  name: string;
  source: string | null;
}

/** Every banned hit in one built file: selectors anywhere, our own calls only where they trace to our sources. */
export function scanFile(text: string, map: SourceMapLike | null): Hit[] {
  const hits: Hit[] = [];
  for (const s of SELECTORS) {
    for (const m of text.matchAll(s.pattern)) hits.push({ name: s.name, source: null });
  }
  const lines = map ? decodeLines(map.mappings) : null;
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  for (const o of OURS) {
    for (const m of text.matchAll(o.pattern)) {
      const at = m.index ?? 0;
      let line = 0;
      while (line + 1 < starts.length && starts[line + 1]! <= at) line++;
      const source = map && lines ? sourceAt(map, lines, line, at - starts[line]!) : null;
      // Without a map nothing can be traced, so every hit counts as ours.
      if (source === null || !/[\\/]node_modules[\\/]/.test(source)) hits.push({ name: o.name, source });
    }
  }
  return hits;
}

/** Every banned hit in a built dist, by file. */
export function scanDist(dist: string): Array<{ file: string; hits: Hit[] }> {
  const dir = join(dist, "assets");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".js"))
    .map((f) => {
      const text = readFileSync(join(dir, f), "utf8");
      const mapPath = join(dir, `${f}.map`);
      const map = existsSync(mapPath) ? (JSON.parse(readFileSync(mapPath, "utf8")) as SourceMapLike) : null;
      return { file: f, hits: scanFile(text, map) };
    })
    .filter((r) => r.hits.length > 0);
}

if (import.meta.main) {
  const dist = process.argv[2] ?? new URL("../dist", import.meta.url).pathname;
  const files = readdirSync(join(dist, "assets")).filter((f) => f.endsWith(".js"));
  const maps = files.filter((f) => existsSync(join(dist, "assets", `${f}.map`))).length;
  const found = scanDist(dist);
  if (found.length > 0) {
    for (const r of found) {
      for (const h of r.hits) console.error(`wallet-grep: ${r.file}: ${h.name}${h.source ? ` (from ${h.source})` : ""}`);
    }
    process.exit(1);
  }
  console.log(`wallet-grep: ${files.length} bundle files (${maps} with source maps): no approval or permit selector anywhere, and no approve, permit, eth_sign, personal_sign or eth_requestAccounts from our code`);
}
