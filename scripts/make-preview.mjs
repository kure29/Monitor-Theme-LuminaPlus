import { copyFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const sourcePath = resolve(root, "docs/images/monitor-theme-preview.png");
const outPath = resolve(root, "preview.png");

if (!existsSync(sourcePath)) {
  throw new Error(`Missing preview source: ${sourcePath}`);
}

copyFileSync(sourcePath, outPath);
console.log(`Wrote ${outPath}`);
