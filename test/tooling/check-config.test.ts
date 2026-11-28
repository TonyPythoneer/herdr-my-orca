import { it } from "vite-plus/test";
import assert from "node:assert/strict";
import { validateConfig } from "../../src/tooling/check-config-core.ts";

function fixture(values: Record<string, string>) {
  const trackedPaths = Object.keys(values);
  return validateConfig({
    trackedPaths,
    readText: (path) => {
      const value = values[path];
      if (value === undefined) throw new Error(`missing ${path}`);
      return value;
    },
  });
}

const valid = () => ({
  "mods/orca-one/mod.json": "{}",
  "mods/orca-one/main.js": "",
  "keys.json": "{}",
  "programs.json": "{}",
  "settings.json": "{}",
  "themes/dark.json": "{}",
  "layouts/orca.json": JSON.stringify({
    children: [{ content: { mod: "orca-one" } }],
    terminal_menu: "orca-one",
    theme: "dark",
    preview: "previews/orca.svg",
  }),
  "previews/orca.svg": "<svg/>",
});

it("accepts tracked objects, nested mod references, menus, themes and previews", () => {
  const result = fixture(valid());
  assert.deepEqual(result, { errors: [], parsedCount: 6, modCount: 1, layoutCount: 1 });
});

it("reports malformed tracked JSON with its path and collects unreadable-file errors", () => {
  const values = valid();
  values["mods/orca-one/mod.json"] = "{";
  const unreadable = "themes/unreadable.json";
  const result = validateConfig({
    trackedPaths: [...Object.keys(values), unreadable],
    readText: (path) => {
      if (path === unreadable) throw new Error("permission denied");
      return values[path];
    },
  });
  assert.ok(result.errors.some((error) => error.startsWith("mods/orca-one/mod.json:")));
  assert.ok(result.errors.includes("themes/unreadable.json: permission denied"));
  assert.ok(result.errors.includes("mods/orca-one/mod.json: manifest must be a JSON object"));
  assert.equal(result.parsedCount, 5);
});

it("rejects absent manifests, layouts and required config objects", () => {
  const result = fixture({ "notes.txt": "ignored" });
  assert.deepEqual(result.errors, [
    "No mod manifests found",
    "keys.json: missing or not a JSON object",
    "programs.json: missing or not a JSON object",
    "settings.json: missing or not a JSON object",
    "No layouts found",
  ]);
});

it("rejects a non-object manifest, missing main module, non-object settings and theme", () => {
  const result = fixture({
    "mods/orca-one/mod.json": "[]",
    "keys.json": "null",
    "programs.json": "[]",
    "settings.json": "{}",
    "themes/dark.json": "[]",
    "layouts/orca.json": "{}",
  });
  assert.deepEqual(result.errors, [
    "mods/orca-one/mod.json: manifest must be a JSON object",
    "mods/orca-one/mod.json: missing tracked main.js",
    "keys.json: missing or not a JSON object",
    "programs.json: missing or not a JSON object",
    "themes/dark.json: theme must be a JSON object",
  ]);
});

it("reports non-object layouts and every invalid nested mod, menu, theme and preview reference", () => {
  const values = valid();
  values["layouts/orca.json"] = JSON.stringify({
    items: [{ mod: "orca-missing" }],
    terminal_menu: "orca-unknown-menu",
    theme: "light",
    preview: "previews/missing.svg",
  });
  values["themes/dark.json"] = "[]";
  const result = fixture(values);
  assert.ok(result.errors.includes('layouts/orca.json: unknown mod "orca-missing"'));
  assert.ok(result.errors.includes('layouts/orca.json: unknown mod "orca-unknown-menu"'));
  assert.ok(result.errors.includes("layouts/orca.json: missing theme light"));
  assert.ok(result.errors.includes("layouts/orca.json: missing preview previews/missing.svg"));
  assert.ok(result.errors.includes("themes/dark.json: theme must be a JSON object"));
  const nonObject = fixture({ ...values, "layouts/orca.json": "null" });
  assert.ok(nonObject.errors.includes("layouts/orca.json: layout must be a JSON object"));
});

it("runs the source CLI against the tracked checkout as a smoke test", async () => {
  const { result, reportResult, updateExitCode } =
    await import("../../src/tooling/check-config.ts");
  assert.deepEqual(result.errors, []);
  assert.ok(result.parsedCount > 0);
  assert.ok(result.modCount > 0);
  assert.ok(result.layoutCount > 0);
  const errors: string[] = [];
  reportResult(
    { errors: ["invalid config"], parsedCount: 1, modCount: 0, layoutCount: 0 },
    {
      onError: (message) => errors.push(message),
    },
  );
  assert.deepEqual(errors, ["invalid config"]);
  const exit = { exitCode: 0 };
  updateExitCode({ errors: ["invalid config"], parsedCount: 1, modCount: 0, layoutCount: 0 }, exit);
  updateExitCode(result, exit);
  assert.equal(exit.exitCode, 1);
});
