import { describe, expect, it } from "vite-plus/test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  deliveryReport,
  isDeliveredFile,
  isDirectEntry,
  selectInstallFiles,
  selectTypedOutputs,
  walk,
} from "../../src/tooling/pack-delivery.ts";

describe("delivery inventory", () => {
  it("excludes test code, snapshots and harness files from delivery", () => {
    expect(isDeliveredFile("mods/orca-demo/main.js")).toBe(true);
    expect(isDeliveredFile("mods/orca-demo/main.test.js")).toBe(false);
    expect(isDeliveredFile("mods/orca-demo/render.golden.json")).toBe(false);
    expect(isDeliveredFile("mods/orca-demo/render.snap.json")).toBe(false);
    expect(isDeliveredFile("mods/orca-demo/flow-harness.mjs")).toBe(false);
    expect(isDeliveredFile("mods/orca-demo/golden.js")).toBe(false);
    expect(isDeliveredFile("mods/orca-demo/golden-ish.js")).toBe(true);
  });

  it("deduplicates tracked and manifest paths, keeps existing files and sorts the result", () => {
    const existing = new Set(["mods/b.js", "settings.json", "mods/a.js"]);
    const installFiles = selectInstallFiles(
      ["mods/b.js", "settings.json"],
      ["mods/a.js", "mods/b.js", "mods/missing.js"],
      (path: string) => existing.has(path),
    );
    expect(installFiles).toEqual(["mods/a.js", "mods/b.js", "settings.json"]);
  });

  it("selects typed outputs from the manifest table and drops legacy sources", () => {
    const typed = { source: "src/mods/demo/main.ts", packId: "demo" };
    const table = new Map([
      ["mods/demo/main.js", typed],
      ["mods/demo/helper.js", typed],
      ["mods/legacy/main.js", { source: "mods/legacy/main.js" }],
    ]);
    const selected = selectTypedOutputs(table);
    expect([...selected.keys()]).toEqual(["mods/demo/main.js", "mods/demo/helper.js"]);
    expect(selected.get("mods/demo/main.js")).toBe(typed);
  });

  it("reports delivery counts from the selected inventory", () => {
    const typedByOutput = new Map([
      ["mods/demo/main.js", { source: "src/mods/demo/main.ts" }],
      ["mods/demo/helper.js", { source: "src/mods/demo/main.ts" }],
      ["mods/demo/other.js", { source: "src/mods/demo/other.ts" }],
    ]);
    const report = deliveryReport({
      installFiles: ["mods/a.js", "mods/b.js", "mods/c.js", "settings.json"],
      trackedFiles: [
        "mods/a.js",
        "mods/b.js",
        "settings.json",
        "mods/a.test.js",
        "mods/a.golden.json",
      ],
      typedByOutput,
      manifestOutputs: 9,
    });
    expect(report).toEqual({
      installationFiles: 4,
      excludedTestFiles: 2,
      typedRuntimeCopies: 3,
      compiledSources: 2,
      bytePreservedFiles: 1,
      manifestOutputs: 9,
    });
  });

  it("does not resolve a missing argv path in the direct-entry guard", () => {
    expect(isDirectEntry("/missing/pack-delivery.ts", "/missing/pack-delivery.ts")).toBe(false);
    expect(isDirectEntry(undefined, "/missing/pack-delivery.ts")).toBe(false);
  });

  it("walks nested delivery directories and returns files only", () => {
    const root = mkdtempSync(join(tmpdir(), "pack-delivery-walk-"));
    try {
      mkdirSync(join(root, "mods/demo"), { recursive: true });
      writeFileSync(join(root, "settings.json"), "{}");
      writeFileSync(join(root, "mods/demo/main.js"), "");
      const files = walk(root)
        .map((path: string) => path.slice(root.length + 1))
        .sort();
      expect(files).toEqual(["mods/demo/main.js", "settings.json"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
