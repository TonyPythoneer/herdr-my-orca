#!/usr/bin/env node
// One explicit entry point for the Orca UI. Herdr still loads each mod by its own name.
import { access, cp, mkdir, readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const PROFILE_FILE = join(REPO_ROOT, "ui", "orca.profile.json");

export async function loadProfile(filename = PROFILE_FILE) {
  return JSON.parse(await readFile(filename, "utf8"));
}

export function collectModules(profile) {
  return Object.values(profile.components ?? {}).flat();
}

function validRelative(value) {
  return typeof value === "string" && value.length > 0 && !isAbsolute(value) &&
    !value.includes("\\") && /^[A-Za-z0-9._/-]+$/.test(value) &&
    value.split("/").every(part => part !== "" && part !== "." && part !== "..");
}

async function exists(path) {
  try { await access(path); return true; } catch { return false; }
}

export function profilePaths(profile) {
  return [...(profile.files ?? []), ...collectModules(profile).map(name => "mods/" + name)];
}

export async function validateProfile(profile, root = REPO_ROOT) {
  const errors = [];
  if (profile.version !== 1) errors.push("Profile version must be 1");
  if (!profile.components || typeof profile.components !== "object" ||
      Array.isArray(profile.components)) errors.push("Missing components groups");
  if (!Array.isArray(profile.files)) errors.push("Missing files list");

  const names = collectModules(profile);
  const paths = profilePaths(profile);
  const all = new Set();
  for (const name of names) {
    if (typeof name !== "string" || !/^[a-z][a-z0-9-]*$/.test(name)) {
      errors.push("Invalid mod name: " + String(name));
    }
  }
  for (const path of paths) {
    if (!validRelative(path)) { errors.push("Unsafe profile path: " + String(path)); continue; }
    if (all.has(path)) errors.push("Duplicate profile path: " + path);
    all.add(path);
    if (!(await exists(join(root, path)))) errors.push("Missing profile path: " + path);
  }
  for (const name of names.filter(n => /^[a-z][a-z0-9-]*$/.test(n))) {
    for (const file of ["mod.json", "main.js"]) {
      const relative = "mods/" + name + "/" + file;
      if (!(await exists(join(root, relative)))) errors.push("Incomplete mod: " + relative);
    }
    try {
      JSON.parse(await readFile(join(root, "mods", name, "mod.json"), "utf8"));
    } catch { errors.push("Invalid mod.json: " + name); }
  }
  if (!validRelative(profile.layout) || !/^[a-z0-9-]+$/.test(profile.layout)) {
    errors.push("Invalid layout name");
    return { errors, names, paths };
  }
  const layoutPath = "layouts/" + profile.layout + ".json";
  if (!all.has(layoutPath)) errors.push("Layout not declared in files: " + layoutPath);
  let layout;
  try { layout = JSON.parse(await readFile(join(root, layoutPath), "utf8")); }
  catch { errors.push("Cannot read layout: " + layoutPath); }
  if (layout) {
    const installed = new Set(names);
    const required = new Set();
    function inspect(node) {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) { node.forEach(inspect); return; }
      if (typeof node.mod === "string") required.add(node.mod);
      Object.values(node).forEach(inspect);
    }
    inspect(layout);
    if (typeof layout.terminal_menu === "string") required.add(layout.terminal_menu);
    for (const mod of required) if (!installed.has(mod)) errors.push("Layout requires undeclared mod: " + mod);
    if (layout.theme !== profile.theme) errors.push("Profile theme and layout theme differ");
    if (layout.preview && !all.has(layout.preview)) errors.push("Layout preview not declared: " + layout.preview);
  }
  if (!validRelative(profile.theme) || !/^[a-z0-9-]+$/.test(profile.theme)) {
    errors.push("Invalid theme name");
  } else if (!all.has("themes/" + profile.theme + ".json")) {
    errors.push("Active theme not declared: " + profile.theme);
  }
  // Check command and overlay dependencies, without importing Herdr-specific JavaScript.
  const keyPath = join(root, "keys.json");
  try {
    const bindings = JSON.parse(await readFile(keyPath, "utf8"));
    const installed = new Set(names);
    for (const section of ["global", "layout:" + profile.layout]) {
      for (const value of Object.values(bindings[section] ?? {})) {
        if (typeof value !== "string") continue;
        const mod = value.startsWith("mod.open:") ? value.slice("mod.open:".length) : value.split(".")[0];
        if ((mod.startsWith("orca-") || mod === "picker" || mod === "agent-config") && !installed.has(mod))
          errors.push("Shortcut needs undeclared mod: " + mod);
      }
    }
  } catch { errors.push("Cannot read keys.json"); }
  for (const name of names) {
    if (!/^[a-z][a-z0-9-]*$/.test(name)) continue;
    let source;
    try { source = await readFile(join(root, "mods", name, "main.js"), "utf8"); }
    catch { continue; }
    // Covers static openOverlay({mod:"..."}) and tab.new({mod:"..."}).
    for (const match of source.matchAll(/\bmod\s*:\s*["']([a-z][a-z0-9-]*)["']/g)) {
      const ref = match[1];
      if (!names.includes(ref) && await exists(join(root, "mods", ref, "mod.json")))
        errors.push(name + " references undeclared mod: " + ref);
    }
  }
  return { errors: [...new Set(errors)], names, paths };
}

export async function installProfile(profile, root = REPO_ROOT, target = join(homedir(), ".config", "herdr-app"), options = {}) {
  const check = await validateProfile(profile, root);
  if (check.errors.length) throw new Error(check.errors.join("\n"));
  const destination = resolve(target);
  if (destination === resolve(root)) throw new Error("Install target cannot be the source repository");
  const actions = [];
  for (const relative of check.paths) {
    const to = join(destination, relative);
    const present = await exists(to);
    const action = present && !options.force ? "skip" : options.dryRun ? "would-copy" : "copy";
    actions.push({ path: relative, action });
    if (action !== "copy") continue;
    await mkdir(dirname(to), { recursive: true });
    await cp(join(root, relative), to, { recursive: true, force: Boolean(options.force), errorOnExist: true });
  }
  return actions;
}

async function main(argv) {
  const [command = "check", ...flags] = argv;
  if (!["check", "list", "install"].includes(command)) throw new Error("Usage: ui-profile.mjs check|list|install [--target DIR] [--dry-run] [--force]");
  const profile = await loadProfile();
  const check = await validateProfile(profile);
  if (check.errors.length) throw new Error(check.errors.join("\n"));
  if (command === "check") {
    console.log("Profile OK: " + profile.title + " (" + check.names.length + " mods, " + profile.files.length + " files)");
    return;
  }
  if (command === "list") {
    for (const [group, mods] of Object.entries(profile.components)) console.log(group + ": " + mods.join(", "));
    return;
  }
  let target = join(homedir(), ".config", "herdr-app");
  let dryRun = false, force = false;
  for (let i = 0; i < flags.length; i++) {
    if (flags[i] === "--target" && flags[i + 1]) target = flags[++i];
    else if (flags[i] === "--dry-run") dryRun = true;
    else if (flags[i] === "--force") force = true;
    else throw new Error("Unknown option: " + flags[i]);
  }
  const actions = await installProfile(profile, REPO_ROOT, target, { dryRun, force });
  for (const a of actions) console.log(a.action + " " + a.path);
  console.log((dryRun ? "Dry run" : "Install") + ": " + actions.filter(a => a.action !== "skip").length + " items; " +
    actions.filter(a => a.action === "skip").length + " preserved. Select the orca layout in Herdr.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
