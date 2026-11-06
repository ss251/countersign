export interface TypedDataInput {
  domain: Record<string, unknown>;
  types: Record<string, Array<{ name: string; type: string }>>;
  primaryType: string;
  message: Record<string, unknown>;
}

export interface WalletApi {
  createWallet(externalId: string): Promise<{ id: string; address: string }>;
  signTypedData(walletId: string, typed: TypedDataInput): Promise<string>;
  personalSign(walletId: string, message: string): Promise<string>;
}

export class WalletApiError extends Error {
  constructor(readonly status: number) {
    super(`Privy answered ${status}.`);
  }
}

/** Privy server wallets, app-controlled (no owner), so the hub needs no per-user authorization key. */
export function privyWalletApi(
  appId: string,
  appSecret: string,
  options: { policyId?: string; fetchImpl?: typeof fetch; base?: string } = {},
): WalletApi {
  const base = options.base ?? "https://api.privy.io";
  const doFetch = options.fetchImpl ?? fetch;
  const headers = {
    authorization: `Basic ${Buffer.from(`${appId}:${appSecret}`).toString("base64")}`,
    "privy-app-id": appId,
    "content-type": "application/json",
  };
  async function post(path: string, body: unknown): Promise<Record<string, unknown>> {
    const response = await doFetch(`${base}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
    if (!response.ok) throw new WalletApiError(response.status);
    return (await response.json()) as Record<string, unknown>;
  }
  return {
    async createWallet(externalId) {
      const body: Record<string, unknown> = { chain_type: "ethereum", external_id: externalId, idempotency_key: externalId };
      if (options.policyId) body.policy_ids = [options.policyId];
      const out = await post("/v1/wallets", body);
      if (typeof out.id !== "string" || typeof out.address !== "string") throw new WalletApiError(502);
      return { id: out.id, address: out.address.toLowerCase() };
    },
    async signTypedData(walletId, typed) {
      const out = await post(`/v1/wallets/${encodeURIComponent(walletId)}/rpc`, {
        method: "eth_signTypedData_v4",
        params: { typed_data: { domain: typed.domain, types: typed.types, message: typed.message, primary_type: typed.primaryType } },
      });
      const signature = (out.data as Record<string, unknown> | undefined)?.signature;
      if (typeof signature !== "string") throw new WalletApiError(502);
      return signature;
    },
    async personalSign(walletId, message) {
      const out = await post(`/v1/wallets/${encodeURIComponent(walletId)}/rpc`, {
        method: "personal_sign",
        params: { message, encoding: "utf-8" },
      });
      const signature = (out.data as Record<string, unknown> | undefined)?.signature;
      if (typeof signature !== "string") throw new WalletApiError(502);
      return signature;
    },
  };
}
