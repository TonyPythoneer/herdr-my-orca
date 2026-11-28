import assert from "node:assert/strict";
import { test, vi } from "vite-plus/test";
import type { AsyncContext } from "gpui-kit";
import Diff from "../../../src/mods/orca-diff/main.js";
import { fake } from "./host.js";

const pending = vi.hoisted((): ((rows: string[]) => void)[] => []);

vi.mock("../../../src/mods/orca-diff/diff-data.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/mods/orca-diff/diff-data.js")>()),
  loadDiff: () => new Promise<string[]>((resolve) => pending.push(resolve)),
}));

test("an older diff load cannot replace a newer result for the same target", async () => {
  const jobs: Promise<unknown>[] = [];
  const cx = fake<AsyncContext>({
    notify() {},
    spawn(fn: (context: AsyncContext) => unknown) {
      const job = Promise.resolve(fn(cx));
      jobs.push(job);
    },
  });
  const view = new Diff();
  Object.assign(view, {
    target: { root: "/repo" },
    rows: [],
    width: 300,
    loadGeneration: 0,
  });
  view.load(cx);
  view.load(cx);
  pending[1](["new result"]);
  await jobs[1];
  pending[0](["old result"]);
  await jobs[0];
  assert.equal(view.rows[0].text, "new result");
});
