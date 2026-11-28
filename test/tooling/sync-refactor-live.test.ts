import { it, onTestFinished } from "vite-plus/test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  chmodSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../../scripts/sync-refactor-live.py", import.meta.url));

function fixture(): {
  run: (...args: string[]) => ReturnType<typeof spawnSync>;
  target: string;
  live: string;
} {
  const root = mkdtempSync(join(tmpdir(), "orca-live-sync-"));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const repo = join(root, "repo"),
    live = join(root, "live"),
    bin = join(root, "bin");
  for (const path of [
    join(repo, "mods/demo"),
    join(repo, "scripts"),
    join(repo, "src/tooling"),
    join(repo, "node_modules/.bin"),
    join(live, "mods/demo"),
    bin,
  ])
    mkdirSync(path, { recursive: true });
  cpSync(script, join(repo, "scripts/sync-refactor-live.py"));
  writeFileSync(join(repo, "src/tooling/build-orca-ui.ts"), "");
  writeFileSync(join(repo, "node_modules/.bin/vpx"), "#!/bin/sh\nexit 0\n");
  chmodSync(join(repo, "node_modules/.bin/vpx"), 0o755);
  writeFileSync(join(bin, "herdr-app"), "#!/bin/sh\nprintf '{\"errors\":[]}'\n");
  chmodSync(join(bin, "herdr-app"), 0o755);
  const git = (...args: string[]): string =>
    execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
  git("init", "-q");
  git("config", "user.name", "test");
  git("config", "user.email", "test@example.invalid");
  const source = join(repo, "mods/demo/main.js"),
    target = join(live, "mods/demo/main.js");
  writeFileSync(source, "old\n");
  writeFileSync(target, "old\n");
  git("add", ".");
  git("commit", "-qm", "base");
  const base = git("rev-parse", "HEAD");
  writeFileSync(source, "new\n");
  writeFileSync(join(repo, "mods/demo/new.test.js"), "test\n");
  writeFileSync(join(repo, "mods/demo/helper.js"), "helper\n");
  git("add", ".");
  git("commit", "-qm", "refactor");
  const run = (...args: string[]) =>
    spawnSync(
      "python3",
      [join(repo, "scripts/sync-refactor-live.py"), "--base", base, "--live", live, ...args],
      {
        encoding: "utf8",
        env: { ...process.env, PATH: bin + ":" + process.env.PATH },
      },
    );
  return { run, target, live };
}

it("dry run never changes live; apply copies only reviewed runtime files", () => {
  const { run, target, live } = fixture();
  const dry = run();
  assert.equal(dry.status, 0, dry.stderr);
  assert.equal(readFileSync(target, "utf8"), "old\n");
  assert.match(dry.stdout, /SKIP ABSENT TEST ARTIFACT/);
  const applied = run("--apply");
  assert.equal(applied.status, 0, applied.stderr);
  assert.equal(readFileSync(target, "utf8"), "new\n");
  assert.equal(readFileSync(join(live, "mods/demo/helper.js"), "utf8"), "helper\n");
  assert.throws(() => readFileSync(join(live, "mods/demo/new.test.js")));
  assert.match(applied.stdout, /no new Herdr errors/);
});

it("a live-only edit blocks the entire copy plan", () => {
  const { run, target, live } = fixture();
  writeFileSync(target, "local edit\n");
  const result = run("--apply");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /live-only edit/);
  assert.equal(readFileSync(target, "utf8"), "local edit\n");
  assert.throws(() => readFileSync(join(live, "mods/demo/helper.js")));
});
