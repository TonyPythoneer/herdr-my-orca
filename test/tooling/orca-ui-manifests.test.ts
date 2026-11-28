import { afterEach, it } from "vite-plus/test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ROOT, ManifestError, loadManifests } from "../../src/tooling/orca-ui-manifests.ts";
import { features, inPlace } from "../../orca-ui/app.mjs";
import { FEATURE, edit, fixture, temp, write } from "../helpers/orca-ui-fixture.ts";

const MANIFEST = `${FEATURE}/manifest.json`;
const cleanupCallbacks: (() => void)[] = [];
const fixtureContext = { after: (callback: () => void) => cleanupCallbacks.push(callback) };
afterEach(() => {
  for (const cleanup of cleanupCallbacks.splice(0)) cleanup();
});
const load = (root) => loadManifests({ root });
const SHARED_MANIFEST = "orca-ui/shared/manifest.json";
const rejects = (root, pattern, path = MANIFEST) =>
  assert.throws(
    () => load(root),
    (error) => error instanceof ManifestError && error.path === path && pattern.test(error.message),
  );

function registryProblems(entries, discovered, root) {
  const problems = [];
  for (const [path, manifest] of discovered) {
    const hits = entries.filter((e) => e.manifest === manifest).length;
    if (hits === 0) problems.push(`${path}: not registered in app.mjs`);
    if (hits > 1) problems.push(`${path}: registered ${hits} times`);
  }
  const known = new Set(discovered.map(([, m]) => m));
  for (const e of entries) {
    if (!known.has(e.manifest)) problems.push(`${e.manifest?.feature}: registered but not on disk`);
    for (const next of e.next)
      if (!existsSync(join(root, next)))
        problems.push(`${e.manifest?.feature}: next ${next} does not exist`);
  }
  return problems;
}

async function diskManifests() {
  const dir = join(ROOT, "orca-ui/features");
  const found = readdirSync(dir, { recursive: true })
    .filter((f) => f.endsWith("manifest.json"))
    .sort();
  const json = async (path) =>
    (await import(pathToFileURL(join(ROOT, path)).href, { with: { type: "json" } })).default;
  return Promise.all(
    [...found.map((f) => `orca-ui/features/${f}`), SHARED_MANIFEST].map(async (path) => [
      path,
      await json(path),
    ]),
  );
}

it("app.mjs registers every manifest on disk exactly once and its next links exist", async () => {
  const discovered = await diskManifests();
  assert.ok(discovered.length > 0);
  assert.deepEqual(registryProblems(features, discovered, ROOT), []);
  for (const e of features) assert.ok(e.area && e.description, e.manifest.feature);
});

it("registry problems: a missing, duplicate, extra entry and a dead next link each fail", async () => {
  const discovered = await diskManifests();
  const [entry] = features;
  assert.match(registryProblems([], discovered, ROOT)[0], /not registered/);
  assert.deepEqual(
    registryProblems(
      features.filter((e) => e.area !== "shared"),
      discovered,
      ROOT,
    ),
    [`${SHARED_MANIFEST}: not registered in app.mjs`],
  );
  assert.deepEqual(registryProblems([...features, entry], discovered, ROOT), [
    "orca-ui/features/right-sidebar/header/manifest.json: registered 2 times",
  ]);
  assert.deepEqual(
    registryProblems([...features, { ...entry, manifest: { feature: "ghost" } }], discovered, ROOT),
    ["ghost: registered but not on disk"],
  );
  assert.match(
    registryProblems([{ ...entry, next: ["nope.js"] }, ...features.slice(1)], discovered, ROOT)[0],
    /does not exist/,
  );
});

it("the real repo loads and every managed destination is under its mod", () => {
  const { table, features: loaded, shared, entries } = loadManifests();
  assert.deepEqual([...loaded.keys()], ["orca-ui/features/right-sidebar/header/manifest.json"]);
  assert.equal(shared.files.length, 16);
  assert.equal(entries.entries.length, 45);
  assert.equal(table.size, 118);
  const feature = [...table].filter(([, row]) => row.kind === "feature").map(([dest]) => dest);
  assert.equal(feature.length, 1);
  for (const dest of feature) assert.match(dest, /^mods\/orca-right-sidebar-header\/[^/]+$/);
  assert.equal([...table.values()].filter((r) => r.kind === "shared").length, 72);
  assert.deepEqual(table.get("mods/orca-agent-flyout/pi-provider.js"), {
    kind: "entry",
    id: "orca-agent-flyout-pi-provider",
    source: "src/mods/orca-agent-flyout/pi-provider.ts",
    mode: 0o644,
    consumers: ["orca-agent-flyout"],
    tests: [],
    layoutSlots: {},
    packId: "orca-agent-flyout-pi-provider",
  });
  assert.deepEqual(table.get("mods/orca-right-sidebar-placeholders/main.js"), {
    kind: "entry",
    id: "orca-right-sidebar-placeholders-main",
    source: "src/mods/orca-right-sidebar-placeholders/main.ts",
    mode: 0o644,
    consumers: ["orca-right-sidebar-placeholders"],
    tests: [],
    layoutSlots: {},
    packId: "orca-right-sidebar-placeholders-main",
  });
  assert.deepEqual(table.get("mods/orca-sidebar-projects/worktree-plan.js"), {
    kind: "entry",
    id: "orca-sidebar-projects-worktree-plan",
    source: "src/mods/orca-sidebar-projects/worktree-plan.ts",
    mode: 0o644,
    consumers: ["orca-sidebar-projects"],
    tests: [],
    layoutSlots: {},
    packId: "orca-sidebar-projects-worktree-plan",
  });
  assert.deepEqual(table.get("mods/orca-status-ports/main.js"), {
    kind: "entry",
    id: "orca-status-ports-main",
    source: "src/mods/orca-status-ports/main.ts",
    mode: 0o644,
    consumers: ["orca-status-ports"],
    tests: [],
    layoutSlots: {},
    packId: "orca-status-ports-main",
  });
  assert.deepEqual(table.get("mods/orca-confirm/main.js"), {
    kind: "entry",
    id: "orca-confirm-main",
    source: "src/mods/orca-confirm/main.ts",
    mode: 0o644,
    consumers: ["orca-confirm"],
    tests: [],
    layoutSlots: {},
    packId: "orca-confirm-main",
  });
  assert.deepEqual(table.get("mods/orca-landing/main.js"), {
    kind: "entry",
    id: "orca-landing-main",
    source: "src/mods/orca-landing/main.ts",
    mode: 0o644,
    consumers: ["orca-landing"],
    tests: [],
    layoutSlots: {},
    packId: "orca-landing-main",
  });
  assert.deepEqual(table.get("mods/orca-float-workspace/main.js"), {
    kind: "entry",
    id: "orca-float-workspace-main",
    source: "src/mods/orca-float-workspace/main.ts",
    mode: 0o644,
    consumers: ["orca-float-workspace"],
    tests: [],
    layoutSlots: {},
    packId: "orca-float-workspace-main",
  });
  assert.deepEqual(table.get("mods/orca-split-menu/main.js"), {
    kind: "entry",
    id: "orca-split-menu-main",
    source: "src/mods/orca-split-menu/main.ts",
    mode: 0o644,
    consumers: ["orca-split-menu"],
    tests: [],
    layoutSlots: {},
    packId: "orca-split-menu-main",
  });
  assert.deepEqual(table.get("mods/orca-handoff/main.js"), {
    kind: "entry",
    id: "orca-handoff-main",
    source: "src/mods/orca-handoff/main.ts",
    mode: 0o644,
    consumers: ["orca-handoff"],
    tests: [],
    layoutSlots: {},
    packId: "orca-handoff-main",
  });
  assert.deepEqual(table.get("mods/orca-tasks/main.js"), {
    kind: "entry",
    id: "orca-tasks-main",
    source: "src/mods/orca-tasks/main.ts",
    mode: 0o644,
    consumers: ["orca-tasks"],
    tests: [],
    layoutSlots: {},
    packId: "orca-tasks-main",
  });
  assert.deepEqual(table.get("mods/orca-pane-header/main.js"), {
    kind: "entry",
    id: "orca-pane-header-main",
    source: "src/mods/orca-pane-header/main.ts",
    mode: 0o644,
    consumers: ["orca-pane-header"],
    tests: [],
    layoutSlots: {},
    packId: "orca-pane-header-main",
  });
  assert.deepEqual(table.get("mods/orca-pane-header/crew.js"), {
    kind: "entry",
    id: "crew",
    source: "src/mods/orca-pane-header/crew.ts",
    mode: 0o644,
    consumers: ["orca-pane-header"],
    tests: [],
    layoutSlots: {},
    packId: "crew",
  });
  assert.deepEqual(table.get("mods/orca-pane-header/status.js"), {
    kind: "entry",
    id: "status",
    source: "src/mods/orca-pane-header/status.ts",
    mode: 0o644,
    consumers: ["orca-pane-header"],
    tests: [],
    layoutSlots: {},
    packId: "status",
  });
  assert.deepEqual(table.get("mods/orca-status-footer/main.js"), {
    kind: "entry",
    id: "orca-status-footer-main",
    source: "src/mods/orca-status-footer/main.ts",
    mode: 0o644,
    consumers: ["orca-status-footer"],
    tests: [],
    layoutSlots: {},
    packId: "orca-status-footer-main",
  });
  assert.deepEqual(table.get("mods/orca-status-footer/scheduler.js"), {
    kind: "entry",
    id: "scheduler",
    source: "src/mods/orca-status-footer/scheduler.ts",
    mode: 0o644,
    consumers: ["orca-status-footer"],
    tests: [],
    layoutSlots: {},
    packId: "scheduler",
  });
});

it("the table maps each destination to its source, mode, tests and slots", () => {
  const root = fixture(fixtureContext);
  write(root, `${FEATURE}/.DS_Store`, "junk");
  const { table, features: loaded } = load(root);
  assert.deepEqual([...loaded.keys()], [MANIFEST]);
  assert.deepEqual([...table.keys()].sort(), [
    "mods/orca-changes/clip.js",
    "mods/orca-context-menu/clip.js",
    "mods/orca-context-menu/transcript.js",
    "mods/orca-files/clip.js",
    "mods/orca-files/icons/a.svg",
    "mods/orca-files/main.js",
    "mods/orca-files/mod.json",
    "mods/orca-files/tool.sh",
    "mods/orca-files/view.js",
    "mods/orca-handoff/clip.js",
    "mods/orca-handoff/transcript.js",
  ]);
  assert.deepEqual(table.get("mods/orca-files/icons/a.svg"), {
    kind: "feature",
    id: "files/main",
    source: `${FEATURE}/icons/a.svg`,
    mode: 0o644,
    consumers: ["orca-files"],
    tests: [`${FEATURE}/view.test.js`, `${FEATURE}/fixture/data.json`],
    layoutSlots: { orca: ["list"] },
  });
  assert.equal(table.get("mods/orca-files/tool.sh").mode, 0o755);

  assert.deepEqual(table.get("mods/orca-files/clip.js"), {
    kind: "shared",
    id: "clip.js",
    source: "orca-ui/shared/clip.js",
    mode: 0o644,
    consumers: ["orca-changes", "orca-files", "orca-handoff", "orca-context-menu"],
    tests: [`${FEATURE}/view.test.js`, `${FEATURE}/fixture/data.json`],
    layoutSlots: { orca: ["list"] },
  });
  assert.deepEqual(table.get("mods/orca-handoff/clip.js").tests, []);
  assert.deepEqual(table.get("mods/orca-handoff/clip.js").layoutSlots, {});
});

const BAD = {
  "a declared file is missing": [(r) => rmSync(join(r, FEATURE, "view.js")), /missing source/],
  "a source file is not listed": [
    (r) => write(r, `${FEATURE}/notes.md`, "x"),
    /notes\.md is not listed/,
  ],
  "a file is declared twice": [
    (r) => edit(r, MANIFEST, (m) => m.files.push("main.js")),
    /declared twice/,
  ],
  "a path leaves the source folder": [
    (r) => edit(r, MANIFEST, (m) => m.files.push("../x.js")),
    /not a path inside/,
  ],
  "a declared source is a symlink": [
    (r) => {
      rmSync(join(r, FEATURE, "view.js"));
      symlinkSync(join(r, FEATURE, "main.js"), join(r, FEATURE, "view.js"));
    },
    /not a regular file/,
  ],
  "an unknown field is present": [
    (r) =>
      edit(r, MANIFEST, (m) => {
        m.commands = [];
      }),
    /unknown field "commands"/,
  ],
  "handwritten claims a shared copy": [
    (r) => edit(r, MANIFEST, (m) => m.handwritten.push("clip.js")),
    /claimed by both/,
  ],
  "a slot id is missing from the layout": [
    (r) =>
      edit(r, MANIFEST, (m) => {
        m.layoutSlots.orca = ["nope"];
      }),
    /has 0 nodes with id "nope"/,
  ],
  "a slot mounts another mod": [
    (r) => write(r, "layouts/orca.json", JSON.stringify({ id: "list", content: { mod: "other" } })),
    /does not mount mod orca-files/,
  ],
  "a key section is missing": [
    (r) => edit(r, MANIFEST, (m) => m.keys.push("layout:ghost")),
    /no section "layout:ghost"/,
  ],
};
for (const [name, [mutate, pattern]] of Object.entries(BAD)) {
  it(`loader rejects: ${name}`, () => {
    const root = fixture(fixtureContext);
    mutate(root);
    rejects(root, pattern);
  });
}

it("a nested slot inside an array passes", () => {
  const root = fixture(fixtureContext);
  write(
    root,
    "layouts/orca.json",
    JSON.stringify({ id: "root", children: [[{ id: "list", content: { mod: "orca-files" } }]] }),
  );
  assert.doesNotThrow(() => load(root));
});

it("loader rejects a second feature that repeats an id or a destination", () => {
  const root = fixture(fixtureContext);
  const twin = "orca-ui/features/files/twin";
  const base = JSON.parse(
    JSON.stringify({
      feature: "files/twin",
      mod: "orca-files",
      source: twin,
      output: "mods/orca-files",
      files: ["main.js"],
      tests: [],
      layoutSlots: {},
      keys: [],
    }),
  );
  write(root, `${twin}/manifest.json`, JSON.stringify(base));
  write(root, `${twin}/main.js`, "x");
  rejects(root, /claimed by both/, `${twin}/manifest.json`);
  write(
    root,
    `${twin}/manifest.json`,
    JSON.stringify({ ...base, feature: "files/main", files: ["other.js"] }),
  );
  write(root, `${twin}/other.js`, "x");
  rmSync(join(root, twin, "main.js"));
  rejects(root, /already defined/, `${twin}/manifest.json`);
});

const BAD_SHARED = {
  "a shared source is missing": [
    (r) => rmSync(join(r, "orca-ui/shared/transcript.js")),
    /missing source orca-ui\/shared\/transcript\.js/,
  ],
  "a shared file is not listed": [
    (r) => write(r, "orca-ui/shared/extra.js", "x"),
    /extra\.js is not listed/,
  ],
  "outputs is empty": [
    (r) =>
      edit(r, SHARED_MANIFEST, (m) => {
        m.files[0].outputs = [];
      }),
    /non-empty array/,
  ],
  "an output has another name": [
    (r) =>
      edit(r, SHARED_MANIFEST, (m) => {
        m.files[0].outputs[0] = "mods/orca-changes/other.js";
      }),
    /must be mods\/<mod>\/clip\.js/,
  ],
  "a shared output names a mod that does not exist": [
    (r) =>
      edit(r, SHARED_MANIFEST, (m) => {
        m.files[0].outputs[0] = "mods/orca-filez/clip.js";
      }),
    /orca-filez has no mod\.json/,
  ],
  "a shared output is a feature output": [
    (r) => {
      write(r, `${FEATURE}/clip.js`, "x");
      edit(r, MANIFEST, (m) => m.files.push("clip.js"));
    },
    /claimed by both/,
  ],
};
for (const [name, [mutate, pattern, path = SHARED_MANIFEST]] of Object.entries(BAD_SHARED)) {
  it(`loader rejects: ${name}`, () => {
    const root = fixture(fixtureContext);
    mutate(root);
    rejects(root, pattern, path);
  });
}

it("an empty shared manifest is fine; a missing or symlinked orca-ui/shared is an error", () => {
  const root = fixture(fixtureContext);
  write(root, SHARED_MANIFEST, '{ "files": [] }');
  for (const name of ["clip.js", "transcript.js"]) rmSync(join(root, "orca-ui/shared", name));
  assert.deepEqual(load(root).shared, { files: [] });
  const elsewhere = temp(fixtureContext);
  write(elsewhere, "manifest.json", '{ "files": [] }');
  rmSync(join(root, "orca-ui/shared"), { recursive: true });
  rejects(root, /does not exist/, SHARED_MANIFEST);
  symlinkSync(elsewhere, join(root, "orca-ui/shared"));
  rejects(root, /symlink or leaves the repo/, SHARED_MANIFEST);
});

it("loader rejects a keys.json that is not an object and a null handwritten list", () => {
  const root = fixture(fixtureContext);
  write(root, "keys.json", "null");
  rejects(root, /keys\.json must be an object/);
  write(root, "keys.json", "{}");
  edit(root, MANIFEST, (m) => {
    m.keys = [];
    m.handwritten = null;
  });
  rejects(root, /"handwritten" must be an array/);
});

it("every mod is a feature or has one in-place map entry, and the entry matches the repo", () => {
  const json = (path) => JSON.parse(readFileSync(join(ROOT, path), "utf8"));
  const mods = readdirSync(join(ROOT, "mods"))
    .filter((m) => existsSync(join(ROOT, "mods", m, "mod.json")))
    .sort();
  const owned = [...loadManifests().features.values()].map((f) => f.mod);
  assert.equal(mods.length, 24);
  assert.deepEqual([...owned, ...inPlace.map((e) => e.mod)].sort(), mods);
  const mounts = {};
  for (const layout of ["orca"]) {
    const walk = (node, id) => {
      if (Array.isArray(node)) node.forEach((n) => walk(n, id));
      else if (node && typeof node === "object") {
        const here = node.id ?? id;
        if (here && node.content?.mod) (mounts[node.content.mod] ??= []).push(`${layout}#${here}`);
        Object.values(node).forEach((n) => walk(n, here));
      }
    };
    walk(json(`layouts/${layout}.json`));
  }
  const keys = json("keys.json");
  for (const e of inPlace) {
    assert.deepEqual(
      [...(e.layouts ?? [])].sort(),
      [...(mounts[e.mod] ?? [])].sort(),
      `${e.mod}: layouts`,
    );

    const bound = Object.entries(keys).flatMap(([section, bindings]) =>
      Object.entries(bindings)
        .filter(([, command]) => command.startsWith(`${e.mod}.`) || command === `mod.open:${e.mod}`)
        .map(([key]) => `${section}:${key}`),
    );
    assert.deepEqual([...(e.keys ?? [])].sort(), bound.sort(), `${e.mod}: keys`);
    for (const f of [...(e.tests ?? []), ...(e.next ?? [])])
      assert.ok(existsSync(join(ROOT, f)), `${e.mod}: ${f}`);
    const onDisk = readdirSync(join(ROOT, "mods", e.mod), { recursive: true })
      .filter((f) => /\.test\.m?js$/.test(f))
      .map((f) => `mods/${e.mod}/${f}`)
      .sort();
    assert.deepEqual(
      (e.tests ?? []).filter((f) => f.startsWith(`mods/${e.mod}/`)).sort(),
      onDisk,
      `${e.mod}: mod tests`,
    );
  }
});

it("a manifest or layout that is a symlink out of the repo is not read", () => {
  const root = fixture(fixtureContext);
  const outside = temp(fixtureContext);
  write(outside, "orca.json", JSON.stringify({ id: "list", content: { mod: "orca-files" } }));
  rmSync(join(root, "layouts/orca.json"));
  symlinkSync(join(outside, "orca.json"), join(root, "layouts/orca.json"));
  rejects(root, /resolves outside the repo/);
});
