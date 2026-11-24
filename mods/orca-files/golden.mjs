import test, { after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

// Characterization (golden master): each scenario's observable result is compared with what the code before
// the refactor produced. `UPDATE_GOLDEN=1` rewrites the file, which is only for recording that first run.
function plain(_key, value) {
  if (value instanceof Map) return { map: [...value] };
  if (value instanceof Set) return { set: [...value] };
  return value;
}
export function goldenSuite(name, scenarios, base = import.meta.url) {
  const file = new URL(`./${name}.golden.json`, base), update = process.env.UPDATE_GOLDEN === "1";
  const stored = update || !existsSync(file) ? {} : JSON.parse(readFileSync(file, "utf8")), results = {};
  for (const [title, run] of Object.entries(scenarios)) {
    test(title, async () => {
      const actual = JSON.parse(JSON.stringify(await run(), plain));
      results[title] = actual;
      if (!update) assert.deepStrictEqual(actual, stored[title], title);
    });
  }
  if (update) after(() => writeFileSync(file, "{\n" + Object.entries(results).map(([title, value]) => `${JSON.stringify(title)}: ${JSON.stringify(value)}`).join(",\n") + "\n}\n"));
}

