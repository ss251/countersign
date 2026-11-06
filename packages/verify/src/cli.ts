#!/usr/bin/env bun
/**
 * countersign verify <slip.json> [--rpc <url>]
 * Prints one line per check, then VALID or INVALID. Exit code 0 when valid, 1 otherwise.
 */

import { readFileSync } from "node:fs";
import type { Slip } from "@countersign/core";
import { verifySlip } from "./verify.ts";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const rpcAt = args.indexOf("--rpc");
const rpcUrl = rpcAt >= 0 ? args[rpcAt + 1] : undefined;

if (!file) {
  console.error("usage: verify <slip.json> [--rpc <url>]");
  process.exit(2);
}

let slip: Slip;
try {
  slip = JSON.parse(readFileSync(file, "utf8")) as Slip;
} catch (e) {
  console.error(`cannot read ${file}: ${(e as Error).message}`);
  process.exit(2);
}

const verdict = await verifySlip(slip, rpcUrl ? { rpcUrl } : {});
for (const f of verdict.findings) console.log(`${f.ok ? "ok  " : "FAIL"} ${f.check.padEnd(17)} ${f.detail}`);
console.log(verdict.valid ? "VALID" : "INVALID");
process.exit(verdict.valid ? 0 : 1);
