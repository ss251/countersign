import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import type { Hex } from "viem";
import {
  canonicalHash,
  canaryMessage,
  runnerAuthMessage,
  slipBodyFor,
  slipHash,
  slipTypedData,
  type HubToRunner,
  type JobOrder,
  type RunnerToHub,
} from "../src/deps.ts";

export type JobAnswer = { output: unknown; countersign?: string } | { fail: string };

export interface RunnerOptions {
  url: string;
  account: PrivateKeyAccount;
  offers: Hex[];
  now: () => number;
  respond: (order: JobOrder) => Promise<JobAnswer>;
  canary?: "answer" | "ignore" | "wrong-key" | "refuse";
}

export interface RunnerHandle {
  ready: Promise<Hex[]>;
  close(): void;
}

/** A real WebSocket runner for tests: signs hello, answers jobs, writes slips. */
export function startRunner(options: RunnerOptions): RunnerHandle {
  const socket = new WebSocket(options.url);
  let settled = false;
  let resolveReady: (offers: Hex[]) => void = () => undefined;
  let rejectReady: (error: Error) => void = () => undefined;
  const ready = new Promise<Hex[]>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  const settle = (offers: Hex[]): void => {
    if (settled) return;
    settled = true;
    resolveReady(offers);
  };
  const failReady = (error: Error): void => {
    if (settled) return;
    settled = true;
    rejectReady(error);
  };

  const send = (frame: RunnerToHub | HubToRunner): void => {
    socket.send(JSON.stringify(frame));
  };

  const answerJob = async (order: JobOrder): Promise<void> => {
    const answer = await options.respond(order);
    if ("fail" in answer) {
      send({ t: "fail", jobId: order.jobId, reason: answer.fail });
      return;
    }
    const body = slipBodyFor(
      order,
      options.account.address,
      canonicalHash(order.input),
      canonicalHash(answer.output),
      options.now(),
      [],
    );
    const hash = slipHash(body);
    const sellerSig = await options.account.signTypedData(slipTypedData(body));
    send({
      t: "result",
      jobId: order.jobId,
      output: answer.output,
      slip: { body, hash, sellerSig },
      ...(typeof answer.countersign === "string" ? { countersign: answer.countersign } : {}),
    });
  };

  const handle = async (text: string): Promise<void> => {
    let frame: HubToRunner;
    try {
      frame = JSON.parse(text) as HubToRunner;
    } catch {
      return;
    }

    switch (frame.t) {
      case "challenge": {
        const sig = await options.account.signMessage({
          message: runnerAuthMessage(frame.nonce),
        });
        send({
          t: "hello",
          seller: options.account.address,
          offers: options.offers,
          nonce: frame.nonce,
          sig,
        });
        break;
      }
      case "ready":
        settle(frame.offers);
        break;
      case "ping":
        send({ t: "pong", ts: frame.ts });
        break;
      case "job":
        try {
          await answerJob(frame.order);
        } catch (error) {
          send({
            t: "fail",
            jobId: frame.order.jobId,
            reason: error instanceof Error ? error.message : "refused",
          });
        }
        break;
      case "canary": {
        const mode = options.canary ?? "answer";
        if (mode === "ignore") break;
        if (mode === "refuse") {
          send({
            t: "canary-fail",
            offerHash: frame.offerHash,
            nonce: frame.nonce,
            reason: "not-served",
          });
          break;
        }
        const served = options.offers.find(
          (hash) => hash.toLowerCase() === frame.offerHash.toLowerCase(),
        );
        if (!served) {
          send({
            t: "canary-fail",
            offerHash: frame.offerHash,
            nonce: frame.nonce,
            reason: "not-served",
          });
          break;
        }
        const account =
          mode === "wrong-key" ? privateKeyToAccount(generatePrivateKey()) : options.account;
        const sig = await account.signMessage({
          message: canaryMessage(served, frame.nonce),
        });
        send({ t: "canary", offerHash: served, nonce: frame.nonce, sig });
        break;
      }
      case "error":
        failReady(new Error(frame.message));
        break;
    }
  };

  socket.onmessage = (event) => {
    void handle(String(event.data));
  };
  socket.onerror = () => failReady(new Error("runner socket error"));
  socket.onclose = () => failReady(new Error("runner socket closed"));

  return {
    ready,
    close: () => {
      socket.close();
    },
  };
}
