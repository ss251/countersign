import { whitechainPaywall } from "@countersign-hub/relay/paywall";
import type { Address } from "viem";

// Charge 0.01 USDT on Whitechain for one route. The relay pays the gas.
export const checkout = (payTo: Address, relay: string) =>
  whitechainPaywall({ price: "0.01", payTo, facilitator: relay, description: "countersign sticker pack" });
