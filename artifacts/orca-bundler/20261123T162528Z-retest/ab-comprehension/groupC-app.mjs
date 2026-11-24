// Orca UI entry point. Start reading here.
//
// A map of the Orca interface: each entry below points at the mod files that draw a screen
// area, plus the settings it uses and where its actions go next. Files are edited in place
// under `mods/`; this file only links them, nothing is generated from it.
//
// Areas without an entry here are not mapped yet: find them under `mods/` and `layouts/`.
export const features = [
  {
    id: "panel/head",
    // Right panel header: title strip, close button, and the view switcher that reveals
    // files, changes, ports, or the harness panels.
    source: "mods/orca-panel-head",
    layouts: ["orca", "orca-unified"],
    shortcuts: "keys.json#layout:orca",
    tests: ["mods/orca-panel-head/panel-gating.test.js", "mods/orca-panel-head/panel-views.test.js"],
    // A reveal ends in another mod: search selects `files`, then dispatches orca-files.search.
    next: ["mods/orca-files/main.js"],
  },
];

// Settings that belong to features: seed-once in the live config, never regenerated.
export const settings = ["keys.json", "settings.json", "programs.json"];
