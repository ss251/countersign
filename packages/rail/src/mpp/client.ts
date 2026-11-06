import Stripe from "stripe";

/**
 * Builds a real Stripe client from a test key.
 *
 * Refuses anything that is not an `sk_test_` or `rk_test_` key, so a live key
 * can never reach this rail by mistake. The rail never calls this by itself:
 * the caller supplies the key once sandbox credentials exist.
 */
export function stripeClientFromKey(key: string): Stripe {
  if (!key.startsWith("sk_test_") && !key.startsWith("rk_test_")) {
    throw new Error("refusing a Stripe key that does not start with sk_test_ or rk_test_");
  }
  return new Stripe(key);
}
