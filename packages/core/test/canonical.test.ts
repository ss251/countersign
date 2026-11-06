import { describe, expect, test } from "bun:test";
import { CanonicalError, canonicalHash, canonicalJson } from "../src/canonical.ts";

describe("canonical JSON", () => {
  test("sorts keys at every depth and strips whitespace", () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { z: true, y: null }], c: "x" } })).toBe(
      '{"a":{"c":"x","d":[3,{"y":null,"z":true}]},"b":1}',
    );
  });

  test("key order is by UTF-16 code unit, not locale", () => {
    expect(canonicalJson({ b: 1, B: 2, a: 3, "é": 4, "\u{1F600}": 5, "ａ": 6 })).toBe(
      '{"B":2,"a":3,"b":1,"é":4,"\u{1F600}":5,"ａ":6}',
    );
  });

  test("insertion order does not change the bytes or the hash", () => {
    const one = { amount: "1500000", offer: "0xabc", nonce: 7 };
    const two = { nonce: 7, offer: "0xabc", amount: "1500000" };
    expect(canonicalJson(one)).toBe(canonicalJson(two));
    expect(canonicalHash(one)).toBe(canonicalHash(two));
  });

  test("drops undefined members, keeps null", () => {
    expect(canonicalJson({ a: undefined, b: null })).toBe('{"b":null}');
  });

  test("escapes strings exactly as JSON does", () => {
    expect(canonicalJson({ s: 'q"\\\n\t\u0001' })).toBe('{"s":"q\\"\\\\\\n\\t\\u0001"}');
  });

  test("refuses values with more than one spelling", () => {
    for (const bad of [1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53, 1n, () => 1, Symbol("x")]) {
      expect(() => canonicalJson({ v: bad })).toThrow(CanonicalError);
    }
    expect(() => canonicalJson([undefined])).toThrow(CanonicalError);
    expect(() => canonicalJson(new Date(0))).toThrow(CanonicalError);
    expect(() => canonicalJson(new Map())).toThrow(CanonicalError);
  });

  test("negative zero is written as 0", () => {
    expect(canonicalJson(-0)).toBe("0");
  });

  test("hash is keccak256 over the UTF-8 bytes", () => {
    expect(canonicalHash({})).toBe("0xb48d38f93eaa084033fc5970bf96e559c33c4cdc07d889ab00b4d63f9590739d");
  });
});
