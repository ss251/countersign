import { readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..");
const shim = join(dir, "scripts/core-shim.ts");
const outdir = join(dir, "dist");

rmSync(outdir, { recursive: true, force: true });

const result = await Bun.build({
  entrypoints: [join(dir, "src/paywall.ts"), join(dir, "src/pay-fetch.ts")],
  outdir,
  root: dir,
  target: "node",
  format: "esm",
  packages: "bundle",
  external: ["viem", "hono"],
  naming: { entry: "[name].[ext]" },
  plugins: [
    {
      name: "core-shim",
      setup(builder) {
        builder.onResolve({ filter: /^@countersign\/core$/ }, () => ({ path: shim }));
      },
    },
  ],
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

const forbidden = ["@countersign/", "bun:sqlite", "from \"ajv", "from \"hono"];
for (const name of ["paywall.js", "pay-fetch.js"]) {
  const text = readFileSync(join(outdir, name), "utf8");
  for (const needle of forbidden) {
    if (text.includes(needle)) {
      console.error(`${name} contains ${needle}`);
      process.exit(1);
    }
  }
  if (!text.includes('from "viem"')) {
    console.error(`${name} does not import viem`);
    process.exit(1);
  }
}
