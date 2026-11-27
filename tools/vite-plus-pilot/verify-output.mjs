import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../../", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("orca-ui/shared/manifest.json", root), "utf8"));
const row = manifest.files.find(({ source }) => source === "orca-ui/shared/list-viewport.js");
assert.ok(row?.outputs.length, "pilot source must be managed");
const load = (url) => import(url.href);
const candidate = await load(new URL("./dist/typed/list-viewport.js", import.meta.url));
const original = await load(new URL(row.source, root));

function compare(other, label) {
  assert.deepEqual(Object.keys(other).sort(), Object.keys(original).sort(), label);
  for (const key of ["ROW", "FULL_ROWS", "VISIBLE_ROWS"]) assert.deepEqual(other[key], original[key], label);
  for (const count of [-1, 0, 1, 4, 5, 6, 100]) {
    assert.equal(other.scrolls(count), original.scrolls(count), label);
    for (const height of [0, 1, 30, 31.5]) {
      assert.equal(other.viewportHeight(count, height), original.viewportHeight(count, height), label);
      for (const gap of [0, 2, 5]) assert.equal(other.viewportHeight(count, height, gap), original.viewportHeight(count, height, gap), label);
    }
  }
}

compare(candidate, "Vite+ generated JS");
for (const path of row.outputs) compare(await load(new URL(path, root)), path);
if (process.argv.includes("--delivery")) {
  for (const path of row.outputs) compare(await load(new URL("./dist/delivery/" + path, import.meta.url)), "packed " + path);
}
console.log("Runtime exports and viewport behavior match source and all manifest outputs.");
