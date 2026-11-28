import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import {
  matchUnofficialApp,
  unofficialByTerminal,
} from "../../../src/mods/orca-header/unofficial-apps.js";

test("matches an executable, a shell command and an exec command", () => {
  assert.equal(matchUnofficialApp(["freebuff"])?.key, "freebuff");
  assert.equal(matchUnofficialApp(["/opt/homebrew/bin/freebuff"])?.key, "freebuff");
  assert.equal(matchUnofficialApp(["zsh", "-lic", "exec freebuff"])?.key, "freebuff");
  assert.equal(matchUnofficialApp(["env", "FOO=1", "freebuff"])?.key, "freebuff");
});

test("matches the shell wrapper Herdr uses for tab.new", () => {
  const argv = [
    "/bin/zsh",
    "-lic",
    '"$@"; exec "$0" -li',
    "/bin/zsh",
    "zsh",
    "-lic",
    "exec freebuff",
  ];
  assert.equal(matchUnofficialApp(argv)?.key, "freebuff");
});

test("does not match the name in an option or prompt", () => {
  assert.equal(
    matchUnofficialApp(["claude", "--append-system-prompt", "fix freebuff tab icon"]),
    null,
  );
  assert.equal(matchUnofficialApp(["zsh", "-lic", "echo freebuff"]), null);
});

test("ignores non-string and oversized terminal arguments", () => {
  assert.equal(matchUnofficialApp(["zsh", "-c", { toString: () => "freebuff" }]), null);
  assert.equal(matchUnofficialApp(["zsh", "-c", `${"x".repeat(4097)} freebuff`]), null);
});

test("keeps argv alignment when an oversized shell command is ignored", () => {
  assert.equal(matchUnofficialApp(["zsh", "-c", "x".repeat(4097), "freebuff"]), null);
});

test("matches complete executable words before the truncated shell-command boundary", () => {
  const script = `${"x".repeat(4081)}; exec freebuff ${"x".repeat(100)}`;
  assert.equal(matchUnofficialApp(["zsh", "-c", script])?.key, "freebuff");
});

test("maps only terminals that run the unofficial CLI, by address", () => {
  const byTerminal = unofficialByTerminal([
    { address: "t1", argv: ["zsh", "-lic", "exec freebuff"] },
    { address: "t2", argv: ["/bin/zsh", "-l"] },
  ]);
  assert.equal(byTerminal.get("t1")?.key, "freebuff");
  assert.equal(byTerminal.get("t2"), undefined);
});
