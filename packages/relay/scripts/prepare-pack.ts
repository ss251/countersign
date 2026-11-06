import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkgPath = join(dir, "package.json");
const backupPath = "/tmp/countersign-relay-package.json.packbak";

const build = spawnSync("bun", ["run", "scripts/build.ts"], { cwd: dir, stdio: "inherit" });
if (build.status !== 0) process.exit(build.status ?? 1);

// Pack rewrites workspace:* to 0.0.0. Those packages are private, so a tarball
// that still depends on them cannot be installed. The built entries already
// contain the core functions they call. The repo manifest is restored after pack
// so the relay server keeps its workspace dependencies.
if (!existsSync(backupPath)) {
  const original = readFileSync(pkgPath, "utf8");
  writeFileSync(backupPath, original);
  const pkg = JSON.parse(original) as { dependencies?: Record<string, string> };
  delete pkg.dependencies?.["@countersign/core"];
  delete pkg.dependencies?.["@countersign/rail"];
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
}
