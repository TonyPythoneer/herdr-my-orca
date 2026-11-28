import { it } from "vite-plus/test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { SPIN_PERIOD_MS } from "../../src/shared/ui-settings.ts";

it("visual assets have one canonical config path and a consumer manifest", () => {
  const root = new URL("../../", import.meta.url);
  const asset = "mods/orca-assets/refresh-cw.svg";
  assert.match(readFileSync(new URL(asset, root), "utf8"), /<svg\b/);
  for (const [mod, file] of [
    ["orca-files", "main.js"],
    ["orca-status-bar", "main.js"],
    ["orca-agent-settings", "page-view.js"],
  ]) {
    const source = readFileSync(new URL("mods/" + mod + "/" + file, root), "utf8");
    assert.ok(source.includes(asset), mod);
    if (mod !== "orca-agent-settings") {
      assert.ok(source.includes('from "./ui-settings.js"'), mod);
      const local = readFileSync(new URL("mods/" + mod + "/ui-settings.js", root), "utf8");
      assert.match(local, /const SPIN_PERIOD_MS = (?:1000|1e3);/);
      assert.match(local, /export \{ SPIN_PERIOD_MS \}/);
      assert.doesNotMatch(local, /\/\*|\/\//);
    }
  }
  assert.equal(SPIN_PERIOD_MS, 1000);
  const manifest = JSON.parse(
    readFileSync(new URL("mods/orca-assets/resources.json", root), "utf8"),
  );
  assert.deepEqual(manifest[asset], [
    "orca-agent-settings",
    "orca-assets",
    "orca-files",
    "orca-status-bar",
  ]);
  assert.equal(existsSync(new URL("mods/orca-assets/ui-settings.js", root)), false);
  const walk = (dir) =>
    readdirSync(new URL(dir, root), { withFileTypes: true }).flatMap((entry) => {
      const path = `${dir}/${entry.name}`;
      return entry.isDirectory() ? walk(path) : [path];
    });
  const visual = walk("mods").filter((path) => /\.(svg|png|jpe?g|webp|gif|ico|avif)$/i.test(path));
  assert.deepEqual(
    visual.filter((path) => !path.startsWith("mods/orca-assets/")),
    [],
  );
  assert.deepEqual(Object.keys(manifest).sort(), visual.sort());
  for (const [path, consumers] of Object.entries(manifest)) {
    assert.ok(existsSync(new URL(path, root)), path);
    assert.ok(consumers.length > 0, path);
  }
});
