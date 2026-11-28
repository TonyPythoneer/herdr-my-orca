import { afterAll, it } from "vite-plus/test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

function plain(_key: string, value: unknown): unknown {
  if (value instanceof Map) return { map: [...value] };
  if (value instanceof Set) return { set: [...value] };
  return value;
}

export function goldenSuite(
  name: string,
  scenarios: Record<string, () => unknown | Promise<unknown>>,
  base: string | URL = import.meta.url,
): void {
  const file = new URL(`./${name}.golden.json`, base);
  const update = process.env.UPDATE_GOLDEN === "1";
  const stored =
    update || !existsSync(file)
      ? {}
      : (JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>);
  const results: Record<string, unknown> = {};
  for (const [title, run] of Object.entries(scenarios)) {
    it(title, async () => {
      const actual = JSON.parse(JSON.stringify(await run(), plain)) as unknown;
      results[title] = actual;
      if (!update) assert.deepStrictEqual(actual, stored[title], title);
    });
  }
  if (update)
    afterAll(() =>
      writeFileSync(
        file,
        "{\n" +
          Object.entries(results)
            .map(([title, value]) => `${JSON.stringify(title)}: ${JSON.stringify(value)}`)
            .join(",\n") +
          "\n}\n",
      ),
    );
}
