import type { Flow } from "../lib/flow.ts";
import { arcDeadlineRefund } from "./arc-deadline-refund.flow.ts";
import { arcSpine } from "./arc-spine.flow.ts";
import { arcWrongAmount } from "./arc-wrong-amount.flow.ts";
import { discovery } from "./discovery.flow.ts";
import { hedera } from "./hedera.flow.ts";
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
  { n: "5", flow: whitechain },
  { n: "4b", flow: slipOnchainWhitechain },
  { n: "6", flow: hedera },
  { n: "7", flow: merchant },
  { n: "8", flow: discovery },
  { n: "9", flow: web },
];

export const FLOWS: Flow[] = MATRIX.map((m) => m.flow);
export const NUMBERS = new Map(MATRIX.map((m) => [m.flow.name, m.n]));
