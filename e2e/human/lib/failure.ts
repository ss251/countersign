/** Throw a captured failure when the run recorded one, even a falsy thrown value. */
export function raiseIfFailed(failed: boolean, failure: unknown): void {
  if (failed) throw failure instanceof Error ? failure : new Error(String(failure));
}
