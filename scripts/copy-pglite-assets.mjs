#!/usr/bin/env node
/**
 * Nitro traces `@electric-sql/pglite` into the serverless bundle but omits
 * pglite.data / pglite.wasm. Preview (no DATABASE_URL) needs those files next
 * to the bundled module. Production with DATABASE_URL never loads PGLite.
 */
import { cpSync, existsSync } from "node:fs";
import { globSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = join(root, "node_modules/@electric-sql/pglite/dist");
const assets = ["pglite.data", "pglite.wasm", "initdb.wasm"];

const bundles = globSync("{.vercel/output,.netlify,.output}/**/*electric-sql__pglite.mjs", {
  cwd: root,
});

if (bundles.length === 0) {
  console.log("[pglite-assets] no bundled pglite module — nothing to copy");
  process.exit(0);
}

for (const rel of bundles) {
  const destDir = join(root, dirname(rel));
  for (const name of assets) {
    const from = join(srcDir, name);
    if (!existsSync(from)) continue;
    cpSync(from, join(destDir, name));
  }
  console.log(`[pglite-assets] copied wasm/data next to ${rel}`);
}
