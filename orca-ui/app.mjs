// Orca UI entry point. Start reading here.
//
// This is the reading map for the Orca interface: each entry names the screen area a feature draws
// and points at the next files to follow. The feature's `manifest.json` says which source files it
// owns, the mod they build into, the layout slots that mount it, the keys it uses and its tests.
// Herdr loads the built copies under `mods/`; those are delivery format, not edit locations.
//
// Not migrated yet: `shared/` helpers and mods without an entry here are still edited in place.
//
// Herdr errors name the built copy (`mods/<mod>/<file>?v=1:<line>:<col>`). Do not open it: pipe
// the error to `node scripts/where-error.mjs`, which prints the file and line to edit and the
// entry below that owns it.
import panelHead from "./features/panel/head/manifest.json" with { type: "json" };

export const features = [
  {
    manifest: panelHead,
    area: "panel",
    // Right panel header: title strip, close button, and the view switcher that reveals
    // files, changes, ports, or the harness panels.
    description: "Right panel header and view switcher.",
    // A reveal ends in another mod: search selects `files`, then dispatches orca-files.search.
    next: ["mods/orca-files/main.js"],
  },
];

// Settings that belong to features rather than to the builder: seed-once, never regenerated.
export const settings = ["keys.json", "settings.json", "programs.json"];

// Build and verification, run from the repo root:
//   node scripts/build-orca-ui.mjs --out <dir>          rebuild managed outputs into <dir>
//   node scripts/build-orca-ui.mjs --check --out .      read-only drift check (0 clean, 1 drift)
export const build = "scripts/build-orca-ui.mjs";
