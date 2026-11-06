import type { Flow } from "../lib/flow.ts";
import { arcDeadlineRefund } from "./arc-deadline-refund.flow.ts";
import { arcGateway } from "./arc-gateway.flow.ts";
import { arcSpine } from "./arc-spine.flow.ts";
import { arcWrongAmount } from "./arc-wrong-amount.flow.ts";
import { discovery } from "./discovery.flow.ts";
import { erc8004Identity } from "./erc8004-identity.flow.ts";
import { hedera } from "./hedera.flow.ts";
import { hederaMcp } from "./hedera-mcp.flow.ts";
import { productionConsole, productionHub } from "./production.flow.ts";
import { publicGateway } from "./public-gateway.flow.ts";
import { publicHedera } from "./public-hedera.flow.ts";
import { publicSpine } from "./public-spine.flow.ts";
import { ratings } from "./ratings.flow.ts";
import { refusals } from "./refusals.flow.ts";
import { runnerRestart } from "./runner-restart.flow.ts";
import { slipOnchainArc, slipOnchainWhitechain } from "./slip-onchain.flow.ts";
import { web } from "./web.flow.ts";
import { merchant, whitechain } from "./whitechain.flow.ts";

/** The coverage matrix, in run order. Numbers match issue #39. */
export const MATRIX: Array<{ n: string; flow: Flow }> = [
  { n: "1", flow: arcSpine },
  { n: "1b", flow: runnerRestart },
  { n: "2", flow: arcWrongAmount },
  { n: "3", flow: arcDeadlineRefund },
  { n: "4a", flow: slipOnchainArc },
  { n: "10", flow: arcGateway },
  { n: "11", flow: refusals },
  { n: "13", flow: ratings },
  { n: "5", flow: whitechain },
  { n: "4b", flow: slipOnchainWhitechain },
  { n: "6", flow: hedera },
  { n: "7", flow: merchant },
  { n: "8", flow: discovery },
  { n: "12", flow: publicSpine },
  { n: "15", flow: publicHedera },
  { n: "16", flow: publicGateway },
  { n: "17", flow: hederaMcp },
  { n: "18", flow: erc8004Identity },
  { n: "14a", flow: productionConsole },
  { n: "14b", flow: productionHub },
  { n: "9", flow: web },
];

export const FLOWS: Flow[] = MATRIX.map((m) => m.flow);
export const NUMBERS = new Map(MATRIX.map((m) => [m.flow.name, m.n]));
