import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const assets = resolve("apps/web/dist/assets");
const workers = readdirSync(assets).filter(name => /^maplibre-gl-worker-.*\.(?:mjs|js)$/.test(name));
assert.equal(workers.length, 1, "The build must emit one MapLibre worker entrypoint");
const visited = new Set();
function checkImports(file) {
  assert.ok(existsSync(file), `Missing worker dependency: ${file}`);
  if (visited.has(file)) return;
  visited.add(file);
  const source = readFileSync(file, "utf8");
  for (const match of source.matchAll(/\bfrom\s*["'](\.[^"']+)["']/g)) {
    checkImports(resolve(dirname(file), match[1]));
  }
}
checkImports(resolve(assets, workers[0]));
console.log(`MapLibre worker dependency check passed (${visited.size} files)`);
