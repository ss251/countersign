import { describe, expect, test } from "bun:test";
import type { TypedDataDefinition } from "viem";
import { verifyTypedData } from "viem";
import type { LocalAccount, PrivateKeyAccount } from "viem/accounts";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { NOT_SIGNED_IN, type RemoteSession, remoteAccount } from "@countersign/buyer";
import { authorizationTypedData, type AuthorizationInput } from "@countersign/core";

interface Field {
  name: string;
  type: string;
}

interface WireTypedData {
  domain?: Record<string, unknown>;
  types: Record<string, readonly Field[]>;
  primaryType: string;
  message: Record<string, unknown>;
}

function revival(type: string, value: unknown): unknown {
  return /^u?int\d*$/.test(type) ? BigInt(value as string) : value;
}

function revive(typedData: WireTypedData): TypedDataDefinition {
  const message: Record<string, unknown> = {};
  for (const field of typedData.types[typedData.primaryType] ?? []) {
    message[field.name] = revival(field.type, typedData.message[field.name]);
  }
  return {
    types: typedData.types,
    primaryType: typedData.primaryType,
    message,
    ...(typedData.domain !== undefined ? { domain: typedData.domain } : {}),
  } as unknown as TypedDataDefinition;
}

interface Captured {
  authorization: string | null;
  body: unknown;
}

function hubStub(
  signer: PrivateKeyAccount,
  capture: Captured,
  send?: (wire: WireTypedData, capture: Captured) => Response | Promise<Response>,
): typeof fetch {
  return Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const request = new Request(input, init);
      capture.authorization = request.headers.get("authorization");
      const text = await request.text();
      const body = JSON.parse(text) as { kind: string; typedData: WireTypedData };
      capture.body = body;
      if (send !== undefined) return send(body.typedData, capture);
      const signature = await signer.signTypedData(revive(body.typedData));
      return Response.json({ signature });
    },
    { preconnect: () => undefined },
  );
}

function statusStub(status: number, body: unknown): typeof fetch {
  return Object.assign(
    async (): Promise<Response> => Response.json(body, { status }),
    { preconnect: () => undefined },
  );
}

function networkStub(reason: "reject" | "hang"): typeof fetch {
  return Object.assign(
    async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      if (reason === "reject") throw new TypeError("fetch failed");
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    },
    { preconnect: () => undefined },
  );
}

function sessionFor(signer: PrivateKeyAccount, token: string): RemoteSession {
  return { hub: "http://hub.invalid", token, address: signer.address };
}

function authorizationFor(buyer: LocalAccount): AuthorizationInput {
  return {
    terms: {
      offerHash: `0x${"12".repeat(32)}`,
      buyer: buyer.address,
      payee: "0x00000000000000000000000000000000000000aa",
      amount: "10000",
      deadline: 1_762_400_300,
      salt: "9",
    },
    chainId: 5042002,
    escrow: "0x4444444444444444444444444444444444444444",
    token: "0x3600000000000000000000000000000000000000",
    tokenName: "USDC",
    tokenVersion: "2",
    validAfter: 0,
    validBefore: 1_762_400_600,
  };
}

async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }
  throw new Error("expected the promise to reject");
}

describe("the remote signer", () => {
  test("a ReceiveWithAuthorization signature verifies against the session address", async () => {
    const signer = privateKeyToAccount(generatePrivateKey());
    const session = sessionFor(signer, "session-token");
    const account = remoteAccount(session, { fetch: hubStub(signer, { authorization: null, body: undefined }) });
    expect(account.address).toBe(signer.address);

    const typedData = authorizationTypedData(authorizationFor(account));
    const signature = await account.signTypedData(typedData);
    const valid = await verifyTypedData({
      ...typedData,
      address: signer.address,
      signature,
    });
    expect(valid).toBe(true);
  });

  test("the request carries the token and the bigints as decimal strings", async () => {
    const signer = privateKeyToAccount(generatePrivateKey());
    const capture: Captured = { authorization: null, body: undefined };
    const account = remoteAccount(sessionFor(signer, "secret-session-token"), { fetch: hubStub(signer, capture) });

    await account.signTypedData(authorizationTypedData(authorizationFor(account)));

    expect(capture.authorization).toBe("Bearer secret-session-token");
    const body = capture.body as {
      kind: string;
      typedData: {
        domain: Record<string, unknown>;
        types: Record<string, readonly Field[]>;
        primaryType: string;
        message: Record<string, unknown>;
      };
    };
    expect(body.kind).toBe("evm");
    expect(body.typedData.primaryType).toBe("ReceiveWithAuthorization");
    expect(body.typedData.types.EIP712Domain).toBeUndefined();
    expect(body.typedData.message.value).toBe("10000");
    expect(body.typedData.message.validAfter).toBe("0");
    expect(body.typedData.message.validBefore).toBe("1762400600");
    expect(typeof body.typedData.message.value).toBe("string");
  });

  test("401, 403 and any other status become their own errors", async () => {
    const signer = privateKeyToAccount(generatePrivateKey());
    const typedData = authorizationTypedData(authorizationFor(signer));

    const unauthorized = remoteAccount(sessionFor(signer, "t"), {
      fetch: statusStub(401, { code: "no-session", message: "Expired." }),
    });
    expect((await rejection(unauthorized.signTypedData(typedData))).message).toBe(NOT_SIGNED_IN);

    const refused = remoteAccount(sessionFor(signer, "t"), {
      fetch: statusStub(403, { code: "refused", message: "Over the cap." }),
    });
    expect((await rejection(refused.signTypedData(typedData))).message).toBe("Refused by the hub: Over the cap.");

    const broken = remoteAccount(sessionFor(signer, "t"), {
      fetch: statusStub(500, { code: "error", message: "Boom." }),
    });
    expect((await rejection(broken.signTypedData(typedData))).message).toBe("The hub could not sign (500).");
  });

  test("an unreachable hub or a timeout says so", async () => {
    const signer = privateKeyToAccount(generatePrivateKey());
    const typedData = authorizationTypedData(authorizationFor(signer));

    const offline = remoteAccount(sessionFor(signer, "t"), { fetch: networkStub("reject") });
    expect((await rejection(offline.signTypedData(typedData))).message).toBe(
      "The hub could not be reached to sign.",
    );

    const slow = remoteAccount(sessionFor(signer, "t"), { fetch: networkStub("hang"), timeoutMs: 5 });
    expect((await rejection(slow.signTypedData(typedData))).message).toBe("The hub could not be reached to sign.");
  });

  test("no error's message contains the session token", async () => {
    const signer = privateKeyToAccount(generatePrivateKey());
    const token = "super-secret-session-token";
    const typedData = authorizationTypedData(authorizationFor(signer));
    const stubs: Array<[string, typeof fetch]> = [
      ["401", statusStub(401, { code: "no-session", message: "Expired." })],
      ["403", statusStub(403, { code: "refused", message: "No." })],
      ["500", statusStub(500, { code: "error", message: "Boom." })],
      ["offline", networkStub("reject")],
    ];

    for (const [name, stub] of stubs) {
      const account = remoteAccount(sessionFor(signer, token), { fetch: stub });
      const error = await rejection(account.signTypedData(typedData));
      expect(error.message).not.toContain(token);
      expect(`${name}: ${error.message}`).not.toContain(token);
    }
  });

  test("signMessage and signTransaction refuse", async () => {
    const signer = privateKeyToAccount(generatePrivateKey());
    const account = remoteAccount(sessionFor(signer, "t"), {
      fetch: hubStub(signer, { authorization: null, body: undefined }),
    });
    expect((await rejection(account.signMessage({ message: "hi" }))).message).toBe(
      "This wallet signs only through the hub's typed-data route.",
    );
    expect(
      (
        await rejection(
          account.signTransaction({
            to: signer.address,
            value: 1n,
            chainId: 5042002,
            gas: 21_000n,
            maxFeePerGas: 1n,
            maxPriorityFeePerGas: 1n,
            nonce: 0,
            type: "eip1559",
          }),
        )
      ).message,
    ).toBe("This wallet signs only through the hub's typed-data route.");
  });
});
