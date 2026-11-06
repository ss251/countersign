/** The header the console sends the person's Privy access token in. */
export const PRIVY_HEADER = "x-privy-token";

export interface Person {
  userId: string;
  /** The person's linked Ethereum wallets, lowercase 0x addresses. */
  wallets: string[];
}

export interface PrivyVerifier {
  verify(accessToken: string): Promise<Person>;
}

/** The token is not valid for this app: answer 401. */
export class PrivySessionError extends Error {}
/** Privy could not be reached: answer 503. */
export class PrivyUnavailableError extends Error {}

export type PersonCheck =
  | { kind: "none" }
  | { kind: "person"; person: Person }
  | { kind: "refused"; status: 401 | 503; code: "bad-session" | "session-unavailable"; message: string };

/** The three calls the verifier makes; a test passes a fake. */
export interface PrivyClientLike {
  getVerificationKey(): Promise<string>;
  verifyAuthToken(token: string, verificationKey: string): Promise<{ appId: string; userId: string }>;
  getUserById(userId: string): Promise<{ linkedAccounts: Array<{ type: string; address?: string; chainType?: string }> }>;
}

export function createPrivyVerifier(
  appId: string,
  appSecret: string,
  options: { client?: PrivyClientLike; cacheMs?: number; now?: () => number } = {},
): PrivyVerifier {
  const client = options.client ?? realClient(appId, appSecret);
  const now = options.now ?? Date.now;
  const lifetime = options.cacheMs ?? 60_000;
  const cache = new Map<string, { wallets: string[]; expiresAt: number }>();

  return {
    async verify(accessToken: string): Promise<Person> {
      let key: string;
      try {
        key = await client.getVerificationKey();
      } catch {
        throw new PrivyUnavailableError("verification key unreachable");
      }

      let claims: { appId: string; userId: string };
      try {
        claims = await client.verifyAuthToken(accessToken, key);
      } catch {
        throw new PrivySessionError("invalid");
      }
      if (claims.appId !== appId) throw new PrivySessionError("wrong app");

      const cached = cache.get(claims.userId);
      if (cached !== undefined && cached.expiresAt > now()) {
        return { userId: claims.userId, wallets: cached.wallets };
      }

      let user: { linkedAccounts: Array<{ type: string; address?: string; chainType?: string }> };
      try {
        user = await client.getUserById(claims.userId);
      } catch {
        throw new PrivyUnavailableError("unreachable");
      }
      const wallets = user.linkedAccounts
        .filter(
          (account) =>
            account.type === "wallet" &&
            account.chainType === "ethereum" &&
            typeof account.address === "string",
        )
        .map((account) => (account.address as string).toLowerCase());
      cache.set(claims.userId, { wallets, expiresAt: now() + lifetime });
      return { userId: claims.userId, wallets };
    },
  };
}

function realClient(appId: string, appSecret: string): PrivyClientLike {
  // Loaded on first use: the package refuses to load wherever a test has left a window global.
  let loaded: Promise<PrivyClientLike> | null = null;
  const client = (): Promise<PrivyClientLike> => {
    loaded ??= import("@privy-io/server-auth").then(({ PrivyClient }) => {
      const real = new PrivyClient(appId, appSecret, { timeout: 5_000 });
      return {
        getVerificationKey: () => real.getVerificationKey(),
        verifyAuthToken: (token, key) => real.verifyAuthToken(token, key),
        getUserById: async (id) =>
          (await real.getUserById(id)) as unknown as {
            linkedAccounts: Array<{ type: string; address?: string; chainType?: string }>;
          },
      };
    });
    return loaded;
  };
  return {
    getVerificationKey: async () => (await client()).getVerificationKey(),
    verifyAuthToken: async (token, key) => (await client()).verifyAuthToken(token, key),
    getUserById: async (id) => (await client()).getUserById(id),
  };
}

export async function personFrom(headers: Headers, privy: PrivyVerifier | undefined): Promise<PersonCheck> {
  if (privy === undefined) return { kind: "none" };
  const token = (headers.get(PRIVY_HEADER) ?? "").trim();
  if (token === "") return { kind: "none" };
  try {
    return { kind: "person", person: await privy.verify(token) };
  } catch (error) {
    if (error instanceof PrivyUnavailableError) {
      return {
        kind: "refused",
        status: 503,
        code: "session-unavailable",
        message: "Refused. Sign-in cannot be checked right now. Nothing was charged.",
      };
    }
    return {
      kind: "refused",
      status: 401,
      code: "bad-session",
      message: "Refused. Your sign-in is not valid. Sign in again.",
    };
  }
}

export function owns(person: Person, address: string | null | undefined): boolean {
  return typeof address === "string" && person.wallets.includes(address.toLowerCase());
}
