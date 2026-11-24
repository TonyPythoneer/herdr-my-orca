// Orca UI entry point. Start reading here.
//
// This is the single source for the Orca interface: each entry below points at the files that
// draw a screen area, plus the settings and generated outputs that belong to it. Herdr loads the
// built copies under `mods/`; those are delivery format, not edit locations.
//
// Not migrated yet: `shared/` helpers and mods without an entry here are still edited in place.
export const features = [
  {
    id: "panel/head",
    // Right panel header: title strip, close button, and the view switcher that reveals
    // files, changes, ports, or the harness panels.
    source: "orca-ui/features/panel/head",
    output: "mods/orca-panel-head",
    manifest: "orca-ui/features/panel/head/manifest.json",
    layouts: ["orca", "orca-unified"],
    shortcuts: "keys.json#layout:orca",
    // A reveal ends in another mod: search selects `files`, then dispatches orca-files.search.
    next: ["mods/orca-files/main.js"],
  },
];

// Settings that belong to features rather than to the builder: seed-once, never regenerated.
export const settings = ["keys.json", "settings.json", "programs.json"];

// Build and verification, run from the repo root:
//   node scripts/build-orca-ui.mjs --out <dir>    rebuild managed outputs into <dir>
//   node scripts/build-orca-ui.mjs --check        read-only drift check (0 clean, 1 drift)
export const build = "scripts/build-orca-ui.mjs";
