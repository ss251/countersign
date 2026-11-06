/**
 * The parts of a Stripe SDK client and a payment intent that mppx uses.
 * Kept structural so a mock and the real SDK are both assignable.
 */
export interface StripePaymentIntent {
  id: string;
  status: string;
  lastResponse?: { headers?: Record<string, string> };
}

export interface StripeClientLike {
  paymentIntents: {
    create(params: Record<string, unknown>, options?: Record<string, unknown>): Promise<StripePaymentIntent>;
  };
}

export interface MockStripeCall {
  params: Record<string, unknown>;
  options?: Record<string, unknown>;
}
