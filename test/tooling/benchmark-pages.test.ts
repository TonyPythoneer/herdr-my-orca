import { it } from "vite-plus/test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../../scripts/benchmark-pages.py", import.meta.url));
type Row = { layout: string; stack: string; page: string; fixture: string };

it("benchmark plan covers every stack child in the layout without native dependencies", () => {
  const r = spawnSync("python3", [script, "--plan"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const plan = JSON.parse(r.stdout) as Row[];
  assert.equal(plan.length, 12);
  for (const layout of ["orca"]) {
    const rows = plan.filter((p) => p.layout === layout);
    assert.equal(rows.filter((p) => p.stack === "main").length, 5);
    assert.equal(rows.filter((p) => p.stack === "panel-body").length, 7);
    assert.equal(
      rows.some((p) => p.page === "skillshare"),
      false,
    );
    assert.equal(rows.find((p) => p.page === "ports")?.fixture, "ssh");
    assert.equal(rows.find((p) => p.page === "changes")?.fixture, "git");
    assert.equal(rows.find((p) => p.page === "workspaces")?.fixture, "folder");
  }
});

it("benchmark distinguishes matches, visual changes, timeouts and missing data; emits summaries", () => {
  const r = spawnSync(
    "python3",
    [fileURLToPath(new URL("../../scripts/benchmark-pages-test.py", import.meta.url))],
    { encoding: "utf8" },
  );
  assert.equal(r.status, 0, r.stdout + r.stderr);
}, 20000);
