/**
 * Privy's embedded wallet signs typed data with Node's Buffer (cs-e2e, run 20261106-181838-9add: "ReferenceError:
 * Buffer is not defined at onSign"). Browsers have no Buffer and Vite adds none, so the console installs the
 * standard one before anything can sign. main.tsx imports this first.
 */
import { Buffer } from "buffer";

const scope = globalThis as { Buffer?: typeof Buffer };
if (typeof scope.Buffer === "undefined") scope.Buffer = Buffer;
