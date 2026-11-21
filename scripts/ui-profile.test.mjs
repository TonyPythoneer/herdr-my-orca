import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { REPO_ROOT, loadProfile, collectModules, validateProfile, installProfile } from "./ui-profile.mjs";

test("Orca profile references valid layout, theme, modules, and shortcut targets", async () => {
  const profile = await loadProfile();
  const result = await validateProfile(profile);
  assert.deepEqual(result.errors, []);
  assert.equal(new Set(collectModules(profile)).size, collectModules(profile).length);
  assert.ok(result.names.includes("orca-new-menu"));
  assert.ok(result.names.includes("agent-config"));
});

test("Missing layout dependency fails validation", async () => {
  const profile = await loadProfile();
  profile.components.shell = profile.components.shell.filter(x => x !== "orca-tabs");
  const result = await validateProfile(profile);
  assert.ok(result.errors.some(x => x.includes("Layout requires undeclared mod: orca-tabs")));
});

test("Unsafe or duplicate paths are rejected", async () => {
  const profile = await loadProfile();
  profile.files.push("../secret.json", "keys.json");
  const result = await validateProfile(profile);
  assert.ok(result.errors.some(x => x.includes("Unsafe profile path")));
  assert.ok(result.errors.some(x => x.includes("Duplicate profile path")));
});

test("Installation is opt-in, dry-run is read-only, and existing settings are preserved", async () => {
  const target = await mkdtemp(join(tmpdir(), "herdr-ui-profile-"));
  const profile = await loadProfile();
  try {
    const dry = await installProfile(profile, REPO_ROOT, target, { dryRun: true });
    assert.ok(dry.every(x => x.action === "would-copy"));
    await assert.rejects(access(join(target, "settings.json")));
    const first = await installProfile(profile, REPO_ROOT, target);
    assert.ok(first.every(x => x.action === "copy"));
    const source = await readFile(join(REPO_ROOT, "settings.json"), "utf8");
    assert.equal(await readFile(join(target, "settings.json"), "utf8"), source);
    await writeFile(join(target, "settings.json"), "personal settings");
    const second = await installProfile(profile, REPO_ROOT, target);
    assert.ok(second.every(x => x.action === "skip"));
    assert.equal(await readFile(join(target, "settings.json"), "utf8"), "personal settings");
    await installProfile(profile, REPO_ROOT, target, { force: true });
    assert.equal(await readFile(join(target, "settings.json"), "utf8"), source);
  } finally {
    await rm(target, { recursive: true, force: true });
  }
});
