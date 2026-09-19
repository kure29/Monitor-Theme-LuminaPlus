import { copyFileSync, cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const packageRoot = resolve(root, ".theme-package");
const output = resolve(root, "theme.tar.gz");

for (const required of ["dist/index.html", "theme.json", "preview.png"]) {
  if (!existsSync(resolve(root, required))) {
    console.error(`Missing ${required}; run the build before packaging.`);
    process.exit(1);
  }
}

rmSync(packageRoot, { force: true, recursive: true });
mkdirSync(packageRoot, { recursive: true });
copyFileSync(resolve(root, "theme.json"), resolve(packageRoot, "theme.json"));
copyFileSync(resolve(root, "preview.png"), resolve(packageRoot, "preview.png"));

cpSync(resolve(root, "dist"), resolve(packageRoot, "dist"), { recursive: true });

rmSync(output, { force: true });
const archive = spawnSync("tar", ["czf", output, "dist", "theme.json", "preview.png"], {
  cwd: packageRoot,
  stdio: "inherit",
});
rmSync(packageRoot, { force: true, recursive: true });
if (archive.status !== 0) process.exit(archive.status ?? 1);
console.log(`Wrote ${output}`);
