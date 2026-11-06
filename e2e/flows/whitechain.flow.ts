/**
 * 5 · Whitechain and 7 · Merchant. Both run against the suite's own relay, merchant server and
 * hub on chain 1874. The relay lives on the Whitechain lane's branch until it is integrated, so
 * until then both flows report NOT RUN and name the reason.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { check, type Flow } from "../lib/flow.ts";
import { ROOT } from "../lib/paths.ts";

const RELAY = join(ROOT, "packages/relay/src/server.ts");
const MERCHANT = join(ROOT, "packages/relay/src/merchant-server.ts");

function relayMissing(): string | null {
  return existsSync(RELAY) && existsSync(MERCHANT) ? null : "relay not in this branch yet";
}

export const whitechain: Flow = {
  name: "whitechain",
  title: "Whitechain USDT payment with zero gas, one-click refund",
  owner: "cs-wc",
  network: "whitechain",
  notRun: relayMissing,
  async run() {
    check(false, "the Whitechain flow is written once the relay is integrated");
  },
};

export const merchant: Flow = {
  name: "merchant",
  title: "Merchant totals, partial refund and export",
  owner: "cs-wc",
  network: "whitechain",
  notRun: relayMissing,
  async run() {
    check(false, "the merchant flow is written once the relay is integrated");
  },
};
