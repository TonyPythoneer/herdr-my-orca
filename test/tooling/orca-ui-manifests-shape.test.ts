import { afterEach, it } from "vite-plus/test";
import assert from "node:assert/strict";
import { ManifestError, loadManifests } from "../../src/tooling/orca-ui-manifests.ts";
import { FEATURE, edit, fixture, write } from "../helpers/orca-ui-fixture.ts";

const MANIFEST = `${FEATURE}/manifest.json`;
const cleanupCallbacks: (() => void)[] = [];
const fixtureContext = { after: (callback: () => void) => cleanupCallbacks.push(callback) };
afterEach(() => {
  for (const cleanup of cleanupCallbacks.splice(0)) cleanup();
});
const SHARED_MANIFEST = "orca-ui/shared/manifest.json";
const BUILD_MANIFEST = "src/build-entries.json";
const rejects = (root, message, path) =>
  assert.throws(
    () => loadManifests({ root }),
    (error) => error instanceof ManifestError && error.path === path && error.message === message,
  );
const rejectsBuild = (root, pattern) =>
  assert.throws(
    () => loadManifests({ root }),
    (error) =>
      error instanceof ManifestError &&
      error.path === BUILD_MANIFEST &&
      pattern.test(error.message),
  );

const FEATURE_CASES = {
  "a manifest that is not an object": [
    (r) => write(r, MANIFEST, "[]"),
    "manifest must be an object",
  ],
  "a null manifest": [(r) => write(r, MANIFEST, "null"), "manifest must be an object"],
  "an unknown field": [
    (r) =>
      edit(r, MANIFEST, (m) => {
        m.extra = 1;
      }),
    'unknown field "extra"',
  ],
  "a missing tests list": [
    (r) =>
      edit(r, MANIFEST, (m) => {
        delete m.tests;
      }),
    'missing "tests"',
  ],
  "a missing layoutSlots": [
    (r) =>
      edit(r, MANIFEST, (m) => {
        delete m.layoutSlots;
      }),
    'missing "layoutSlots"',
  ],
  "an empty feature name": [
    (r) =>
      edit(r, MANIFEST, (m) => {
        m.feature = "";
      }),
    '"feature" must be a non-empty string',
  ],
  "a numeric feature name": [
    (r) =>
      edit(r, MANIFEST, (m) => {
        m.feature = 5;
      }),
    '"feature" must be a non-empty string',
  ],
  "a mod name with a slash": [
    (r) =>
      edit(r, MANIFEST, (m) => {
        m.mod = "a/b";
      }),
    '"mod" must be one folder name',
  ],
  "a mod name that starts with a dot": [
    (r) =>
      edit(r, MANIFEST, (m) => {
        m.mod = ".x";
      }),
    '"mod" must be one folder name',
  ],
  "a numeric mod name": [
    (r) =>
      edit(r, MANIFEST, (m) => {
        m.mod = 5;
      }),
    '"mod" must be one folder name',
  ],
  "a source that is not the manifest's folder": [
    (r) =>
      edit(r, MANIFEST, (m) => {
        m.source = "elsewhere";
      }),
    `"source" must be ${FEATURE}`,
  ],
  "an output that is not mods/<mod>": [
    (r) =>
      edit(r, MANIFEST, (m) => {
        m.output = "mods/other";
      }),
    '"output" must be mods/orca-files',
  ],
  "files that are not a list": [
    (r) =>
      edit(r, MANIFEST, (m) => {
        m.files = "main.js";
      }),
    '"files" must be an array of strings',
  ],
  "a non-string in files": [
    (r) =>
      edit(r, MANIFEST, (m) => {
        m.files.push(7);
      }),
    '"files" must be an array of strings',
  ],
  "handwritten that is not a list": [
    (r) =>
      edit(r, MANIFEST, (m) => {
        m.handwritten = null;
      }),
    '"handwritten" must be an array of strings',
  ],
  "tests that are not a list": [
    (r) =>
      edit(r, MANIFEST, (m) => {
        m.tests = {};
      }),
    '"tests" must be an array of strings',
  ],
  "keys that are not a list": [
    (r) =>
      edit(r, MANIFEST, (m) => {
        m.keys = "layout:orca";
      }),
    '"keys" must be an array of strings',
  ],
  "layoutSlots that is a list": [
    (r) =>
      edit(r, MANIFEST, (m) => {
        m.layoutSlots = [];
      }),
    '"layoutSlots" must map layout names to arrays of ids',
  ],
  "layoutSlots that is null": [
    (r) =>
      edit(r, MANIFEST, (m) => {
        m.layoutSlots = null;
      }),
    '"layoutSlots" must map layout names to arrays of ids',
  ],
  "a layoutSlots value that is not a list of strings": [
    (r) =>
      edit(r, MANIFEST, (m) => {
        m.layoutSlots.orca = [3];
      }),
    '"layoutSlots" must map layout names to arrays of ids',
  ],
  "a handwritten path that leaves the mod": [
    (r) =>
      edit(r, MANIFEST, (m) => {
        m.handwritten = ["../x.js"];
      }),
    'handwritten entry "../x.js" is not a path inside the mod',
  ],
  "an absolute handwritten path": [
    (r) =>
      edit(r, MANIFEST, (m) => {
        m.handwritten = ["/x.js"];
      }),
    'handwritten entry "/x.js" is not a path inside the mod',
  ],
  "a handwritten path with a backslash": [
    (r) =>
      edit(r, MANIFEST, (m) => {
        m.handwritten = ["a\\b.js"];
      }),
    'handwritten entry "a\\b.js" is not a path inside the mod',
  ],
  "an empty handwritten path": [
    (r) =>
      edit(r, MANIFEST, (m) => {
        m.handwritten = [""];
      }),
    'handwritten entry "" is not a path inside the mod',
  ],
  "a handwritten path that is a folder": [
    (r) =>
      edit(r, MANIFEST, (m) => {
        m.handwritten = ["sub/"];
      }),
    'handwritten entry "sub/" is not a path inside the mod',
  ],
  "a handwritten path of dots": [
    (r) =>
      edit(r, MANIFEST, (m) => {
        m.handwritten = ["."];
      }),
    'handwritten entry "." is not a path inside the mod',
  ],
};
for (const [name, [mutate, message]] of Object.entries(FEATURE_CASES)) {
  it(`feature shape rejects ${name}`, () => {
    const root = fixture(fixtureContext);
    mutate(root);
    rejects(root, message, MANIFEST);
  });
}

it("feature shape: fields are checked before values, and a missing handwritten list means none", () => {
  const root = fixture(fixtureContext);
  edit(root, MANIFEST, (m) => {
    m.extra = 1;
    m.feature = "";
  });
  rejects(root, 'unknown field "extra"', MANIFEST);
  const second = fixture(fixtureContext);
  edit(second, MANIFEST, (m) => {
    delete m.handwritten;
    delete m.tests;
  });
  rejects(second, 'missing "tests"', MANIFEST);
  const third = fixture(fixtureContext);
  edit(third, MANIFEST, (m) => {
    delete m.handwritten;
  });
  assert.deepEqual(loadManifests({ root: third }).features.get(MANIFEST).handwritten, []);
});

const SHARED_CASES = {
  "a shared manifest that is not { files }": [
    (r) =>
      edit(r, SHARED_MANIFEST, (m) => {
        m.extra = 1;
      }),
    'manifest must be { "files": [...] }',
  ],
  "a files value that is not a list": [
    (r) => write(r, SHARED_MANIFEST, '{"files":{}}'),
    'manifest must be { "files": [...] }',
  ],
  "an item that is not an object": [
    (r) =>
      edit(r, SHARED_MANIFEST, (m) => {
        m.files.push(null);
      }),
    "each file needs only source and outputs",
  ],
  "an item with an extra key": [
    (r) =>
      edit(r, SHARED_MANIFEST, (m) => {
        m.files[0].note = "x";
      }),
    "each file needs only source and outputs",
  ],
  "a source outside managed roots": [
    (r) =>
      edit(r, SHARED_MANIFEST, (m) => {
        m.files[0].source = "elsewhere/clip.js";
      }),
    'source "elsewhere/clip.js" must be orca-ui/shared/<name>.js or src/shared/<name>.ts',
  ],
  "a source that is not a string": [
    (r) =>
      edit(r, SHARED_MANIFEST, (m) => {
        m.files[0].source = 5;
      }),
    'source "5" must be orca-ui/shared/<name>.js or src/shared/<name>.ts',
  ],
  "a source that is not a .js or .ts file": [
    (r) =>
      edit(r, SHARED_MANIFEST, (m) => {
        m.files[0].source = "orca-ui/shared/clip.txt";
      }),
    'source "orca-ui/shared/clip.txt" must be orca-ui/shared/<name>.js or src/shared/<name>.ts',
  ],
  "a source in a subfolder": [
    (r) =>
      edit(r, SHARED_MANIFEST, (m) => {
        m.files[0].source = "orca-ui/shared/sub/clip.js";
      }),
    'source "orca-ui/shared/sub/clip.js" must be orca-ui/shared/<name>.js or src/shared/<name>.ts',
  ],
  "a source declared twice": [
    (r) =>
      edit(r, SHARED_MANIFEST, (m) => {
        m.files.push({ source: m.files[0].source, outputs: ["mods/orca-files/clip.js"] });
      }),
    "source orca-ui/shared/clip.js is declared twice",
  ],
  "outputs that are not a list": [
    (r) =>
      edit(r, SHARED_MANIFEST, (m) => {
        m.files[0].outputs = "mods/orca-files/clip.js";
      }),
    'orca-ui/shared/clip.js: "outputs" must be a non-empty array of strings',
  ],
  "an output that is not a string": [
    (r) =>
      edit(r, SHARED_MANIFEST, (m) => {
        m.files[0].outputs.push(4);
      }),
    'orca-ui/shared/clip.js: "outputs" must be a non-empty array of strings',
  ],
  "an output in a subfolder": [
    (r) =>
      edit(r, SHARED_MANIFEST, (m) => {
        m.files[0].outputs[0] = "mods/orca-files/sub/clip.js";
      }),
    'output "mods/orca-files/sub/clip.js" must be mods/<mod>/clip.js',
  ],
  "an output outside mods": [
    (r) =>
      edit(r, SHARED_MANIFEST, (m) => {
        m.files[0].outputs[0] = "other/orca-files/clip.js";
      }),
    'output "other/orca-files/clip.js" must be mods/<mod>/clip.js',
  ],
  "an output listed twice": [
    (r) =>
      edit(r, SHARED_MANIFEST, (m) => {
        m.files[0].outputs.push(m.files[0].outputs[0]);
      }),
    "output mods/orca-changes/clip.js is declared twice",
  ],
  "an output in a mod without mod.json": [
    (r) =>
      edit(r, SHARED_MANIFEST, (m) => {
        m.files[0].outputs.push("mods/nothing/clip.js");
      }),
    "output mods/nothing/clip.js: mods/nothing has no mod.json, check the mod name",
  ],
};
for (const [name, [mutate, message]] of Object.entries(SHARED_CASES)) {
  it(`shared shape rejects ${name}`, () => {
    const root = fixture(fixtureContext);
    mutate(root);
    rejects(root, message, SHARED_MANIFEST);
  });
}

it("shared shape: a source name may use dots, dashes and underscores", () => {
  const root = fixture(fixtureContext);
  write(root, "orca-ui/shared/a_b-c.d.js", "x\n");
  write(root, "mods/orca-context-menu/mod.json", "{}\n");
  edit(root, SHARED_MANIFEST, (m) => {
    m.files.push({
      source: "orca-ui/shared/a_b-c.d.js",
      outputs: ["mods/orca-context-menu/a_b-c.d.js"],
    });
  });
  assert.ok(loadManifests({ root }).table.has("mods/orca-context-menu/a_b-c.d.js"));
});

it("shared shape accepts a TypeScript source and a JavaScript delivery name", () => {
  const root = fixture(fixtureContext);
  write(root, "src/shared/clip-ts.ts", "export const n: string = 'clip';\n");
  write(root, "mods/orca-context-menu/mod.json", "{}\n");
  edit(root, SHARED_MANIFEST, (m) => {
    m.files.push({
      source: "src/shared/clip-ts.ts",
      outputs: ["mods/orca-context-menu/clip-ts.js"],
    });
  });
  assert.ok(loadManifests({ root }).table.has("mods/orca-context-menu/clip-ts.js"));
});

const BUILD_ENTRY_CASES = {
  "a non-object manifest": [(r) => write(r, BUILD_MANIFEST, "[]"), /manifest must be/],
  "an unknown manifest field": [
    (r) =>
      edit(r, BUILD_MANIFEST, (m) => {
        m.extra = true;
      }),
    /manifest must be/,
  ],
  "a non-list entries value": [
    (r) => write(r, BUILD_MANIFEST, '{"entries":{}}'),
    /manifest must be/,
  ],
  "an entry with an unknown field": [
    (r) =>
      edit(r, BUILD_MANIFEST, (m) => {
        m.entries.push({
          id: "x",
          source: "src/mods/orca-files/tool.ts",
          output: "mods/orca-files/tool.js",
          extra: true,
        });
      }),
    /each entry needs only id, source and output/,
  ],
  "an invalid pack id": [
    (r) =>
      edit(r, BUILD_MANIFEST, (m) => {
        m.entries.push({
          id: "Bad ID",
          source: "src/mods/orca-files/tool.ts",
          output: "mods/orca-files/tool.js",
        });
      }),
    /lowercase Pack entry id/,
  ],
  "a source outside src": [
    (r) =>
      edit(r, BUILD_MANIFEST, (m) => {
        m.entries.push({ id: "x", source: "outside/tool.ts", output: "mods/orca-files/tool.js" });
      }),
    /inside src/,
  ],
  "a non-TypeScript source": [
    (r) =>
      edit(r, BUILD_MANIFEST, (m) => {
        m.entries.push({
          id: "x",
          source: "src/mods/orca-files/tool.js",
          output: "mods/orca-files/tool.js",
        });
      }),
    /inside src/,
  ],
  "a source that escapes src": [
    (r) =>
      edit(r, BUILD_MANIFEST, (m) => {
        m.entries.push({ id: "x", source: "src/../outside.ts", output: "mods/orca-files/tool.js" });
      }),
    /inside src/,
  ],
  "an output that does not mirror its source": [
    (r) => {
      write(r, "src/mods/orca-files/tool.ts", "export {};\n");
      edit(r, BUILD_MANIFEST, (m) => {
        m.entries.push({
          id: "x",
          source: "src/mods/orca-files/tool.ts",
          output: "mods/orca-files/other.js",
        });
      });
    },
    /must mirror/,
  ],
  "a missing source": [
    (r) =>
      edit(r, BUILD_MANIFEST, (m) => {
        m.entries.push({
          id: "x",
          source: "src/mods/orca-files/tool.ts",
          output: "mods/orca-files/tool.js",
        });
      }),
    /missing source/,
  ],
  "an output for a missing mod": [
    (r) => {
      write(r, "src/mods/orca-missing/tool.ts", "export {};\n");
      edit(r, BUILD_MANIFEST, (m) => {
        m.entries.push({
          id: "x",
          source: "src/mods/orca-missing/tool.ts",
          output: "mods/orca-missing/tool.js",
        });
      });
    },
    /has no mod.json/,
  ],
};
for (const [name, [mutate, pattern]] of Object.entries(BUILD_ENTRY_CASES)) {
  it(`build entry shape rejects ${name}`, () => {
    const root = fixture(fixtureContext);
    mutate(root);
    rejectsBuild(root, pattern);
  });
}

it("build entries reject duplicate ids and sources", () => {
  const root = fixture(fixtureContext);
  write(root, "src/mods/orca-files/first.ts", "export {};\n");
  write(root, "src/mods/orca-files/second.ts", "export {};\n");
  edit(root, BUILD_MANIFEST, (m) => {
    m.entries.push(
      { id: "same-id", source: "src/mods/orca-files/first.ts", output: "mods/orca-files/first.js" },
      {
        id: "same-id",
        source: "src/mods/orca-files/second.ts",
        output: "mods/orca-files/second.js",
      },
    );
  });
  rejectsBuild(root, /entry id same-id is declared twice/);

  const second = fixture(fixtureContext);
  write(second, "src/mods/orca-files/first.ts", "export {};\n");
  edit(second, BUILD_MANIFEST, (m) => {
    m.entries.push(
      {
        id: "first-id",
        source: "src/mods/orca-files/first.ts",
        output: "mods/orca-files/first.js",
      },
      {
        id: "second-id",
        source: "src/mods/orca-files/first.ts",
        output: "mods/orca-files/first.js",
      },
    );
  });
  rejectsBuild(second, /source src\/mods\/orca-files\/first\.ts is declared twice/);
});

it("build entries reject pack ids and output paths already owned elsewhere", () => {
  const root = fixture(fixtureContext);
  write(root, "src/shared/clip-ts.ts", "export {};\n");
  write(root, "src/mods/orca-files/tool.ts", "export {};\n");
  edit(root, SHARED_MANIFEST, (m) => {
    m.files.push({ source: "src/shared/clip-ts.ts", outputs: ["mods/orca-files/clip-ts.js"] });
  });
  edit(root, BUILD_MANIFEST, (m) => {
    m.entries.push({
      id: "clip-ts",
      source: "src/mods/orca-files/tool.ts",
      output: "mods/orca-files/tool.js",
    });
  });
  rejectsBuild(root, /Pack entry id clip-ts is already declared/);

  const second = fixture(fixtureContext);
  write(second, "src/mods/orca-files/main.ts", "export {};\n");
  edit(second, BUILD_MANIFEST, (m) => {
    m.entries.push({
      id: "files-main",
      source: "src/mods/orca-files/main.ts",
      output: "mods/orca-files/main.js",
    });
  });
  rejectsBuild(second, /claimed by both/);
});
