import type { MockStripeCall, StripeClientLike, StripePaymentIntent } from "./types.ts";

export interface MockStripeClient extends StripeClientLike {
  /** Every `paymentIntents.create()` call, in order. */
  calls: MockStripeCall[];
}

/**
 * A Stripe client double for offline tests and the mock server.
 * It records what mppx asked for and never leaves the process.
 */
export function mockStripeClient(options: { fail?: boolean } = {}): MockStripeClient {
  const calls: MockStripeCall[] = [];
  return {
    calls,
    paymentIntents: {
      async create(params: Record<string, unknown>, requestOptions?: Record<string, unknown>): Promise<StripePaymentIntent> {
        calls.push({ params, options: requestOptions });
        return {
          id: `pi_mock_${calls.length}`,
          status: options.fail ? "requires_payment_method" : "succeeded",
        };
      },
    },
  };
}
