import { describe, expect, test } from "bun:test";
import {
  checkGuardExceptionTable,
  findGuardException,
  guardExceptionsFor,
  staleGuardExceptionLines,
  type GuardException,
  type GuardExceptionTable,
} from "../surface.ts";

const childSpawn: GuardException = {
  source: "packages/runner/src/child.ts",
  pattern: "Bun.",
  reason: "runWithBun runs only when globalThis.Bun is defined",
};

describe("guard exceptions", () => {
  test("an attributed hit is excused when source and pattern both match", () => {
    expect(findGuardException([childSpawn], childSpawn.source, childSpawn.pattern)).toEqual(
      childSpawn,
    );
  });

  test("the same source with a different pattern is not excused", () => {
    expect(findGuardException([childSpawn], childSpawn.source, "import.meta.main")).toBeNull();
  });

  test("the same pattern in a different source is not excused", () => {
    expect(
      findGuardException([childSpawn], "packages/runner/src/cli.ts", childSpawn.pattern),
    ).toBeNull();
  });

  test("an unattributed hit is never excused", () => {
    expect(findGuardException([childSpawn], null, childSpawn.pattern)).toBeNull();
  });

  test("an empty reason throws when the table is checked", () => {
    const table: GuardExceptionTable = {
      cli: [{ ...childSpawn, reason: "  " }],
    };
    expect(() => checkGuardExceptionTable(table)).toThrow(/empty reason/);
  });

  test("an empty source or pattern throws when the table is checked", () => {
    expect(() =>
      checkGuardExceptionTable({ cli: [{ ...childSpawn, source: "" }] }),
    ).toThrow(/empty source/);
    expect(() =>
      checkGuardExceptionTable({ cli: [{ ...childSpawn, pattern: "" }] }),
    ).toThrow(/empty pattern/);
  });

  test("a stale exception is an error naming it", () => {
    expect(staleGuardExceptionLines("cli", [childSpawn], [])).toEqual([
      'stale guard exception for cli: packages/runner/src/child.ts "Bun."',
    ]);
  });

  test("an excused exception is not stale", () => {
    expect(staleGuardExceptionLines("cli", [childSpawn], [childSpawn])).toEqual([]);
  });

  test("the shipped table is valid and relay and mcp have none", () => {
    expect(() => checkGuardExceptionTable()).not.toThrow();
    expect(guardExceptionsFor("relay")).toEqual([]);
    expect(guardExceptionsFor("mcp")).toEqual([]);
    expect(guardExceptionsFor("cli")).toHaveLength(2);
  });
});
