import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register(new URL("../../scripts/gpui-stub-loader.mjs", import.meta.url));
const { default: Changes } = await import("./main.js");

test("refresh separates index and worktree counts, preserves paths and caps porcelain records", async () => {
  globalThis.__herdrSpaces = () => [{ active: true, folder: "/repo", machine: "remote", id: "s" }];
  const status = ["MM dir/a\tb", "AD bin", "DU conflicted", ...Array(998).fill("?? untracked")].join("\0");
  const calls = [];
  globalThis.__herdrExec = (bin, args, options) => {
    assert.equal(bin, "git");
    assert.deepEqual(options, { cwd: "/repo", on: "remote" });
    calls.push(args);
    let stdout = "/repo\n";
    if (args.includes("status")) stdout = status;
    if (args.includes("diff")) stdout = args.includes("--cached") ? "1\t2\tdir/a\tb\0-\t-\tbin\0" : "3\t4\tdir/a\tb\0";
    return { code: 0, stdout };
  };
  const view = new Changes();
  view.input = { set_value() {} };
  const cx = { spawn(fn) { this.task = fn(this); }, notify() {} };
  view.refresh(cx);
  await cx.task;
  assert.equal(calls.length, 4);
  assert.equal(view.error, null);
  assert.equal(view.limited, true);
  assert.equal(view.loading, false);
  assert.equal(view.files.length, 1002);
  assert.deepEqual(view.files.slice(0, 5).map(f => [f.path, f.section, f.status, f.add, f.del]), [
    ["dir/a\tb", "staged", "M", 1, 2], ["dir/a\tb", "changes", "M", 3, 4],
    ["bin", "staged", "A", 0, 0], ["bin", "changes", "D", 0, 0], ["conflicted", "conflicts", "!", 0, 0],
  ]);
  assert.equal(view.files[2].binary, true);
  assert.equal(view.files[4].xy, "DU");
  assert.equal(view.files.at(-1).fresh, true);
});
