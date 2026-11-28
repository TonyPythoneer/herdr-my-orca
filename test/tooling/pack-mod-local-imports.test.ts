import { it } from "vite-plus/test";
import assert from "node:assert/strict";
import { packModLocalImportsPlugin } from "../../src/tooling/pack-mod-local-imports.ts";

const root = "/workspace";
const rows = [
  ["mods/orca-a/main.js", { source: "src/mods/orca-a/main.ts", packId: "orca-a-main" }],
  ["mods/orca-a/panel-motion.js", { source: "src/shared/panel-motion.ts", packId: "panel-motion" }],
  ["mods/orca-b/main.js", { source: "src/mods/orca-b/main.ts", packId: "orca-b-main" }],
  ["mods/orca-b/panel-motion.js", { source: "src/shared/panel-motion.ts", packId: "panel-motion" }],
] as const;

it("rewrites canonical shared imports to each consumer mod copy", () => {
  const plugin = packModLocalImportsPlugin({ rows, root });
  const code = 'import { panelFrame } from "../../shared/panel-motion.js";\nexport { panelFrame };';
  assert.equal(
    plugin.renderChunk(code, { fileName: "typed/orca-a-main.js" }),
    'import { panelFrame } from "./panel-motion.js";\nexport { panelFrame };',
  );
  assert.equal(
    plugin.renderChunk(code, { fileName: "typed/orca-b-main.js" }),
    'import { panelFrame } from "./panel-motion.js";\nexport { panelFrame };',
  );
});

it("rewrites Pack chunk ids to their mod-local delivered filenames", () => {
  const featureRows = [
    [
      "mods/orca-right-sidebar-header/main.js",
      {
        source: "src/mods/orca-right-sidebar-header/main.ts",
        packId: "orca-right-sidebar-header-main",
      },
    ],
    [
      "mods/orca-right-sidebar-header/panel-gating.js",
      {
        source: "src/mods/orca-right-sidebar-header/panel-gating.ts",
        packId: "orca-right-sidebar-header-panel-gating",
      },
    ],
  ] as const;
  const plugin = packModLocalImportsPlugin({ rows: featureRows, root });
  const code = 'import { visibleTools } from "./orca-right-sidebar-header-panel-gating.js";';
  assert.equal(
    plugin.renderChunk(code, { fileName: "typed/orca-right-sidebar-header-main.js" }),
    'import { visibleTools } from "./panel-gating.js";',
  );
});

it("rewrites preserved source-root imports for registered files to mod-local paths", () => {
  const plugin = packModLocalImportsPlugin({
    rows: [
      [
        "mods/orca-demo/main.js",
        { source: "src/mods/orca-demo/main.ts", packId: "orca-demo-main" },
      ],
      [
        "mods/orca-demo/commands.js",
        { source: "src/mods/orca-demo/commands.ts", packId: "orca-demo-commands" },
      ],
    ],
    root,
  });
  const code = 'import { COMMAND } from "./mods/orca-demo/commands.js";';
  assert.equal(
    plugin.renderChunk(code, { fileName: "typed/orca-demo-main.js" }),
    'import { COMMAND } from "./commands.js";',
  );
});

it("leaves nested imports alone when their basename matches a Pack id", () => {
  const plugin = packModLocalImportsPlugin({
    rows: [
      ["mods/demo/main.js", { source: "src/mods/demo/main.ts", packId: "demo-main" }],
      ["mods/demo/demo-helper.js", { source: "src/mods/demo/helper.ts", packId: "demo-helper" }],
    ],
    root,
  });
  const code = 'import { old } from "./legacy/demo-helper.js";';
  assert.equal(plugin.renderChunk(code, { fileName: "typed/demo-main.js" }), null);
});

it("leaves external and unmigrated local imports unchanged", () => {
  const plugin = packModLocalImportsPlugin({ rows, root });
  const code = 'import { View } from "gpui-kit";\nimport { old } from "./legacy.js";';
  assert.equal(plugin.renderChunk(code, { fileName: "typed/orca-a-main.js" }), null);
  assert.equal(plugin.renderChunk(code, { fileName: "typed/unmanaged.js" }), null);
});

it("fails closed if a canonical source has no generated copy for the consumer mod", () => {
  const plugin = packModLocalImportsPlugin({ rows: rows.slice(0, 3), root });
  const code = 'import { panelFrame } from "../../shared/panel-motion.js";';
  assert.throws(
    () => plugin.renderChunk(code, { fileName: "typed/orca-b-main.js" }),
    /no generated output in mod orca-b/,
  );
});

it("importSource returns undefined for unknown node types", () => {
  const plugin = packModLocalImportsPlugin({ rows, root });
  const code = 'import("dynamic").then(() => {});';
  const result = plugin.renderChunk(code, { fileName: "typed/orca-a-main.js" });
  assert.equal(result, null);
});

it("relativeSource returns null when no candidate matches bySource", () => {
  const plugin = packModLocalImportsPlugin({ rows, root });
  const code = 'import { x } from "./nonexistent.js";';
  const result = plugin.renderChunk(code, { fileName: "typed/orca-a-main.js" });
  assert.equal(result, null);
});

it("outputSpecifier throws when a source resolves to multiple mod-local paths", () => {
  // Same packId maps to two outputs in different mods with different relative paths
  const ambiguousRows = [
    ["mods/orca-a/main.js", { source: "src/mods/orca-a/main.ts", packId: "orca-a-main" }],
    ["mods/orca-b/main.js", { source: "src/mods/orca-a/main.ts", packId: "orca-a-main" }],
    [
      "mods/orca-a/panel-motion.js",
      { source: "src/shared/panel-motion.ts", packId: "panel-motion" },
    ],
    [
      "mods/orca-b/shared/panel-motion.js",
      { source: "src/shared/panel-motion.ts", packId: "panel-motion" },
    ],
  ] as const;
  const plugin = packModLocalImportsPlugin({ rows: ambiguousRows, root });
  const code = 'import { panelFrame } from "../../shared/panel-motion.js";';
  assert.throws(
    () => plugin.renderChunk(code, { fileName: "typed/orca-a-main.js" }),
    /resolves to different mod-local paths/,
  );
});
