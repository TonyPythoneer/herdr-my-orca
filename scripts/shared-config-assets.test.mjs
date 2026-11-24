import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { SPIN_PERIOD_MS } from "../orca-ui/shared/ui-settings.js";

test("shared config asset exists, consumer paths agree and legacy duplicates are removed", () => {
  const root = new URL("../", import.meta.url);
  const asset = "mods/orca-assets/refresh-cw.svg";
  assert.match(readFileSync(new URL(asset, root), "utf8"), /<svg\b/);
  for (const [mod, file] of [["orca-files","main.js"],["orca-status","main.js"],["orca-agent-manager","page-view.js"]]) {
    const source = readFileSync(new URL("mods/" + mod + "/" + file, root), "utf8");
    assert.ok(source.includes(asset), mod);
    if (mod !== "orca-agent-manager") {
      assert.ok(source.includes('from "./ui-settings.js"'), mod);
      const local = readFileSync(new URL("mods/" + mod + "/ui-settings.js", root), "utf8");
      assert.equal(local.split("// Generated from ")[0], readFileSync(new URL("orca-ui/shared/ui-settings.js", root), "utf8"));
    }
    assert.equal(existsSync(new URL("mods/" + mod + "/refresh-cw.svg", root)), false);
  }
  assert.equal(SPIN_PERIOD_MS, 1000);
  const manifest = JSON.parse(readFileSync(new URL("mods/orca-assets/resources.json", root), "utf8"));
  assert.deepEqual(manifest[asset], ["orca-agent-manager", "orca-files", "orca-status"]);
  assert.equal(existsSync(new URL("mods/orca-assets/ui-settings.js", root)), false);
});
