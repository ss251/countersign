import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "..", "package.json");
const backupPath = "/tmp/countersign-relay-package.json.packbak";

if (!existsSync(backupPath)) process.exit(0);
writeFileSync(pkgPath, readFileSync(backupPath, "utf8"));
unlinkSync(backupPath);
