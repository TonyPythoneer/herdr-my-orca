import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

type Cleanup = { after(callback: () => void): void };
type JsonObject = { [key: string]: JsonValue };
type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject;

export const write = (root: string, rel: string, content: string | Buffer, mode?: number): void => {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), content);
  if (mode) chmodSync(join(root, rel), mode);
};

export const edit = (root: string, rel: string, change: (json: JsonObject) => void): void => {
  const json = JSON.parse(readFileSync(join(root, rel), "utf8")) as JsonObject;
  change(json);
  write(root, rel, JSON.stringify(json, null, 2));
};

export const temp = (cleanup: Cleanup): string => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "orca-ui-")));
  cleanup.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};

export const FEATURE = "orca-ui/features/files/main";

function writeSharedHelpers(root: string): void {
  write(root, "orca-ui/shared/clip.js", 'export const n = "clip.js";\n');
  write(root, "orca-ui/shared/transcript.js", 'export const n = "transcript.js"');
  write(
    root,
    "orca-ui/shared/manifest.json",
    JSON.stringify(
      {
        files: [
          {
            source: "orca-ui/shared/clip.js",
            outputs: [
              "mods/orca-changes/clip.js",
              "mods/orca-files/clip.js",
              "mods/orca-handoff/clip.js",
              "mods/orca-context-menu/clip.js",
            ],
          },
          {
            source: "orca-ui/shared/transcript.js",
            outputs: ["mods/orca-handoff/transcript.js", "mods/orca-context-menu/transcript.js"],
          },
        ],
      },
      null,
      2,
    ),
  );
}

export function fixture(cleanup: Cleanup): string {
  const root = temp(cleanup);
  write(root, "src/build-entries.json", JSON.stringify({ entries: [] }));
  write(
    root,
    "layouts/orca.json",
    JSON.stringify({ id: "root", children: [{ id: "list", content: { mod: "orca-files" } }] }),
  );
  write(root, "keys.json", JSON.stringify({ global: {}, "layout:orca": {} }));
  write(
    root,
    `${FEATURE}/manifest.json`,
    JSON.stringify(
      {
        feature: "files/main",
        mod: "orca-files",
        source: FEATURE,
        output: "mods/orca-files",
        files: ["mod.json", "main.js", "view.js", "icons/a.svg", "tool.sh"],
        handwritten: ["extra.js"],
        tests: ["view.test.js", "fixture/data.json"],
        layoutSlots: { orca: ["list"] },
        keys: ["layout:orca"],
      },
      null,
      2,
    ),
  );
  write(root, `${FEATURE}/mod.json`, "{}\n");
  write(root, `${FEATURE}/main.js`, "export default 1;\n");
  write(root, `${FEATURE}/view.js`, "export const view = 1;\n");
  write(root, `${FEATURE}/icons/a.svg`, "<svg/>\n");
  write(root, `${FEATURE}/tool.sh`, "#!/bin/sh\n", 0o755);
  write(root, `${FEATURE}/view.test.js`, "// test\n");
  write(root, `${FEATURE}/fixture/data.json`, "{}\n");
  writeSharedHelpers(root);
  write(root, "mods/orca-files/extra.js", "// handwritten\n");
  for (const mod of [
    "orca-files",
    "orca-changes",
    "orca-handoff",
    "orca-context-menu",
    "orca-right-sidebar-placeholders",
  ])
    write(root, `mods/${mod}/mod.json`, "{}\n");
  write(root, "mods/orca-right-sidebar-placeholders/main.js", "export default 2;\n");
  return root;
}
