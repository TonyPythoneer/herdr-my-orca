import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import {
  NPM_INSTALLS,
  activeSessions,
  installMethodFor,
  npmManaged,
  resolveLinkTarget,
  uninstallCommand,
} from "../../../src/mods/orca-agent-settings/install.ts";

test("npm methods are allowlisted and build argv, never a shell string", () => {
  assert.deepEqual(installMethodFor("claude"), {
    kind: "npm",
    package: "@anthropic-ai/claude-code",
  });
  assert.deepEqual(uninstallCommand(installMethodFor("claude")), {
    executable: "npm",
    args: ["uninstall", "-g", "@anthropic-ai/claude-code"],
  });
  assert.equal(installMethodFor("cursor"), null);
  assert.equal(uninstallCommand({ kind: "npm", package: "bad; rm -rf /" }), null);
  for (const pkg of Object.values(NPM_INSTALLS)) {
    assert.match(pkg, /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/);
  }
});

test("npm-managed executables are recognized by their real path under npm's root", () => {
  const root = "/opt/homebrew/lib/node_modules";
  assert.equal(
    npmManaged(
      "/opt/homebrew/bin/claude",
      "/opt/homebrew/lib/node_modules/@anthropic-ai/claude-code/cli.js",
      root,
      "@anthropic-ai/claude-code",
    ),
    true,
  );
  assert.equal(
    npmManaged(
      "/Users/me/.local/bin/claude",
      "/Users/me/.local/bin/claude",
      root,
      "@anthropic-ai/claude-code",
    ),
    false,
  );
  assert.equal(
    npmManaged(
      "/opt/homebrew/bin/foo",
      "/opt/homebrew/lib/node_modules/other/cli.js",
      root,
      "@anthropic-ai/claude-code",
    ),
    false,
  );
  assert.equal(
    npmManaged(
      "/opt/homebrew/bin/foo",
      "/opt/homebrew/lib/node_modules-other/foo",
      root,
      "@anthropic-ai/claude-code",
    ),
    false,
  );
});

test("a relative readlink target resolves to the npm package path", () => {
  assert.equal(
    resolveLinkTarget(
      "/opt/homebrew/bin/claude",
      "../lib/node_modules/@anthropic-ai/claude-code/cli.js",
    ),
    "/opt/homebrew/lib/node_modules/@anthropic-ai/claude-code/cli.js",
  );
  assert.equal(
    resolveLinkTarget("/opt/homebrew/bin/claude", "/usr/local/bin/claude"),
    "/usr/local/bin/claude",
  );
  assert.equal(resolveLinkTarget("/opt/homebrew/bin/claude", ""), null);
});

test("active sessions are found by program key and by a custom executable", () => {
  const terminals = [
    { address: "t1", state: "live", program: { key: "claude" } },
    { address: "t2", state: "live", program: { key: "shell" }, argv: ["/custom/claude", "--flag"] },
    { address: "t3", state: "live", program: { key: "shell" }, argv: ["claude", "prompt"] },
    { address: "t4", state: "closed", program: { key: "claude" } },
  ];
  assert.deepEqual(
    activeSessions(terminals, "claude", ["claude"]).map((t) => t.address),
    ["t1", "t2", "t3"],
  );
  assert.deepEqual(activeSessions(terminals, "codex", ["codex"]), []);
});
