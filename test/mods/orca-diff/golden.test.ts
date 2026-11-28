import { test, afterAll } from "vite-plus/test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

function plain(_key: unknown, value: unknown) {
  if (value instanceof Map) return { map: [...value] };
  if (value instanceof Set) return { set: [...value] };
  return value;
}

export function goldenSuite(
  name: string,
  scenarios: Record<string, () => unknown>,
  base: string | URL = import.meta.url,
) {
  const file = new URL(`./${name}.golden.json`, base),
    update = process.env.UPDATE_GOLDEN === "1";
  const stored = update || !existsSync(file) ? {} : JSON.parse(readFileSync(file, "utf8")),
    results = {};
  for (const [title, run] of Object.entries(scenarios)) {
    test(title, async () => {
      const actual = JSON.parse(JSON.stringify(await run(), plain));
      results[title] = actual;
      if (!update) assert.deepStrictEqual(actual, stored[title], title);
    });
  }
  if (update)
    afterAll(() =>
      writeFileSync(
        file,
        "{\n" + Object.entries(results).map(([title, value]) => `${JSON.stringify(title)}: ${JSON.stringify(value)}`).join(",\n") + "\n}\n",
      ),
    );
}

test("goldenSuite builds a suite from scenarios", () => {
  assert.equal(typeof goldenSuite, "function");
});
