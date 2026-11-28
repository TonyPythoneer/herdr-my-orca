import { afterEach, test, vi } from "vite-plus/test";
import assert from "node:assert/strict";
import { stored, workspaceOptions } from "../../../src/mods/orca-sidebar-projects/storage.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

test("stored reads and workspace options invalidate when another mod writes", () => {
  const values = new Map<string, string>();
  let published: unknown = null;
  vi.stubGlobal("__herdrShared", (key: string) =>
    key === "workspace.options.v1" ? published : undefined,
  );
  vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null });

  const initial = workspaceOptions();
  assert.equal(workspaceOptions(), initial);
  values.set("workspace.options.v1", '{"groupBy":"none"}');
  assert.equal(workspaceOptions().groupBy, "none");
  assert.notEqual(workspaceOptions(), initial);
  published = { groupBy: "workspace-status", sortBy: "name" };
  assert.equal(workspaceOptions().groupBy, "workspace-status");
  assert.equal(workspaceOptions().sortBy, "name");
  values.set("workspace.options.v1", '{"groupBy":"repo"}');
  assert.equal(workspaceOptions().groupBy, "workspace-status");
  values.set("projects.saved.v1", '["/one"]');
  assert.deepEqual(stored("projects.saved.v1", [] as string[]), ["/one"]);
  values.set("projects.saved.v1", '["/two"]');
  assert.deepEqual(stored("projects.saved.v1", [] as string[]), ["/two"]);
  published = null;
  values.delete("workspace.options.v1");
  assert.equal(workspaceOptions().groupBy, "repo");
});

test("stored returns the cached value for an unchanged raw string", () => {
  const values = new Map<string, string>([["cache.key", "[1,2]"]]);
  vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null });
  const first = stored("cache.key", [] as number[]);
  assert.equal(stored("cache.key", [] as number[]), first);
  assert.deepEqual(first, [1, 2]);
});

test("stored falls back when the raw value is missing, malformed or the wrong shape", () => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null });
  const fallback = { kept: true };
  assert.equal(stored("missing", fallback), fallback);
  values.set("malformed", "{not json");
  assert.equal(stored("malformed", fallback), fallback);
  values.set("array-for-object", "[1]");
  assert.equal(stored("array-for-object", fallback), fallback);
  values.set("object-for-array", '{"a":1}');
  assert.deepEqual(stored("object-for-array", [] as number[]), []);
  values.set("scalar", "5");
  assert.equal(stored("scalar", fallback), fallback);
  values.set("null-raw", "null");
  assert.equal(stored("null-raw", fallback), fallback);
});

test("stored falls back when localStorage throws", () => {
  vi.stubGlobal("localStorage", {
    getItem: () => {
      throw new Error("storage denied");
    },
  });
  const fallback = ["fallback"];
  assert.equal(stored("denied", fallback), fallback);
});

test("workspace options merge saved values over the defaults and ignore non-object sources", () => {
  let published: unknown = null;
  const values = new Map<string, string>();
  vi.stubGlobal("__herdrShared", (key: string) =>
    key === "workspace.options.v1" ? published : undefined,
  );
  vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null });

  published = ["not", "an", "object"];
  values.set("workspace.options.v1", "[1,2,3]");
  assert.equal(workspaceOptions().groupBy, "repo");
  assert.equal(workspaceOptions().hideDefaultBranchWorkspace, false);

  published = "text";
  values.set("workspace.options.v1", '{"sortBy":"recent","filterRepoIds":["r"]}');
  const merged = workspaceOptions();
  assert.equal(merged.sortBy, "recent");
  assert.deepEqual(merged.filterRepoIds, ["r"]);
  assert.equal(merged.alwaysShowDefaultBranchWorkspace, true);
  assert.equal(merged.visibleWorkspaceHostIds, null);

  values.set("workspace.options.v1", "5");
  assert.equal(workspaceOptions().sortBy, "manual");
});

test("workspace options keep the same object while the saved source is unchanged", () => {
  const published = { groupBy: "none" };
  vi.stubGlobal("__herdrShared", (key: string) =>
    key === "workspace.options.v1" ? published : undefined,
  );
  const first = workspaceOptions();
  assert.equal(workspaceOptions(), first);
  assert.equal(first.groupBy, "none");
});
