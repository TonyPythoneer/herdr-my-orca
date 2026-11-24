import test from "node:test";
import assert from "node:assert/strict";
import {
  PERMISSION_CHOICES,
  effectiveChoice,
  normalizePermissions,
  permissionArgs,
  permissionChoices,
  readPermission,
  reconcilePermissions,
  stripPermission,
  supportsPermissions,
  withPermission,
} from "./permissions.js";

test("every stored choice except custom is a real one", () => {
  assert.deepEqual(PERMISSION_CHOICES, ["own", "ask", "auto", "full-access"]);
  assert.ok(!PERMISSION_CHOICES.includes("custom"));
});

test("each choice writes its recipe and reads back as itself", () => {
  const runs = {
    claude: ["claude"],
    codex: ["codex", "--no-daemon"],
    opencode: ["opencode"],
    grok: ["grok"],
    gemini: ["gemini"],
  };
  for (const [key, run] of Object.entries(runs)) {
    for (const choice of permissionChoices(key)) {
      const written = withPermission(key, run, choice);
      assert.ok(Array.isArray(written), `${key}/${choice} should be expressible`);
      assert.equal(readPermission(key, written), choice, `${key}/${choice} should read back`);
      // Idempotent: writing the same choice twice changes nothing.
      assert.deepEqual(withPermission(key, written, choice), written);
      // The executable is never touched.
      assert.equal(written[0], run[0]);
    }
  }
});

test("each recipe lands where Orca's flags expect it", () => {
  assert.deepEqual(withPermission("claude", ["claude"], "ask"), ["claude", "--permission-mode", "default"]);
  assert.deepEqual(withPermission("claude", ["claude"], "auto"), ["claude", "--permission-mode", "auto"]);
  assert.deepEqual(withPermission("claude", ["claude"], "full-access"), ["claude", "--dangerously-skip-permissions"]);
  assert.deepEqual(withPermission("codex", ["codex"], "ask"), [
    "codex", "-a", "on-request", "-s", "read-only", "-c", "approvals_reviewer=user",
  ]);
  assert.deepEqual(withPermission("codex", ["codex"], "full-access"), [
    "codex", "--dangerously-bypass-approvals-and-sandbox",
  ]);
  assert.deepEqual(withPermission("opencode", ["opencode"], "auto"), ["opencode", "--auto"]);
  assert.deepEqual(withPermission("grok", ["grok"], "full-access"), ["grok", "--permission-mode", "bypassPermissions"]);
});

test("switching choices removes the old flag with its value", () => {
  const codex = ["codex", "--no-daemon", "-c", "disable_paste_burst=true"];
  const full = withPermission("codex", codex, "full-access");
  assert.deepEqual(full, ["codex", "--no-daemon", "-c", "disable_paste_burst=true", "--dangerously-bypass-approvals-and-sandbox"]);
  const ask = withPermission("codex", full, "ask");
  assert.deepEqual(ask, ["codex", "--no-daemon", "-c", "disable_paste_burst=true", "-a", "on-request", "-s", "read-only", "-c", "approvals_reviewer=user"]);
  // Only approvals_reviewer is a permission group: the other -c pair is untouched.
  assert.deepEqual(withPermission("codex", ask, "own"), codex);
});

test("own strips known flags and appends nothing", () => {
  assert.deepEqual(withPermission("claude", ["claude", "--dangerously-skip-permissions"], "own"), ["claude"]);
  assert.deepEqual(stripPermission("claude", ["claude", "--permission-mode", "auto", "--verbose"]), ["claude", "--verbose"]);
  assert.equal(readPermission("claude", ["claude"]), "own");
  assert.equal(readPermission("gemini", ["gemini"]), "own");
});

test("a choice the agent cannot express is null, not a fake recipe", () => {
  assert.equal(permissionArgs("gemini", "ask"), null);
  assert.equal(permissionArgs("gemini", "auto"), null);
  assert.equal(withPermission("gemini", ["gemini"], "auto"), null);
  assert.deepEqual(permissionChoices("gemini"), ["own", "full-access"]);
  assert.deepEqual(permissionChoices("opencode"), ["own", "auto"]);
  assert.deepEqual(permissionChoices("claude"), ["own", "ask", "auto", "full-access"]);
});

test("agents with no permission flag support only own and show no row", () => {
  assert.equal(supportsPermissions("pi"), false);
  assert.equal(permissionChoices("pi"), null);
  assert.equal(withPermission("pi", ["pi"], "full-access"), null);
  assert.equal(readPermission("pi", ["pi", "--anything"]), "own");
});

test("an unknown permission combination reads as custom and is never rewritten by itself", () => {
  assert.equal(readPermission("claude", ["claude", "--permission-mode", "plan"]), "custom");
  assert.equal(readPermission("codex", ["codex", "-a", "never"]), "custom");
  // A non-permission `-c` pair is not a carrier: Codex's paste tweak and a model override are own
  // or full, while its approval roots are custom.
  assert.equal(readPermission("codex", ["codex", "--no-daemon", "-c", "disable_paste_burst=true", "--dangerously-bypass-approvals-and-sandbox"]), "full-access");
  assert.equal(readPermission("codex", ["codex", "-c", "model=gpt-5"]), "own");
  assert.equal(readPermission("codex", ["codex", "-c", "approval_policy=never"]), "custom");
  // A custom command still becomes one of the four choices when the person picks one.
  assert.deepEqual(withPermission("claude", ["claude", "--permission-mode", "plan"], "full-access"), [
    "claude", "--permission-mode", "plan", "--dangerously-skip-permissions",
  ]);
});

test("permissions parse, default and reject damage", () => {
  assert.deepEqual(normalizePermissions(undefined), { default: "own", overrides: {} });
  assert.deepEqual(normalizePermissions({}), { default: "own", overrides: {} });
  assert.deepEqual(normalizePermissions({ default: "ask", overrides: { claude: "full-access" } }), {
    default: "ask",
    overrides: { claude: "full-access" },
  });
  assert.match(normalizePermissions([]).error, /must be an object/);
  assert.match(normalizePermissions({ default: "yolo" }).error, /permissions.default/);
  assert.match(normalizePermissions({ overrides: [] }).error, /permissions.overrides/);
  assert.match(normalizePermissions({ overrides: { claude: "yolo" } }).error, /permissions.overrides.claude/);
});

test("the effective choice prefers an agent's override, else the default", () => {
  const permissions = { default: "ask", overrides: { claude: "full-access" } };
  assert.equal(effectiveChoice(permissions, "claude"), "full-access");
  assert.equal(effectiveChoice(permissions, "codex"), "ask");
  assert.equal(effectiveChoice({ default: "ask", overrides: { claude: "nope" } }, "claude"), "ask");
  assert.equal(effectiveChoice({}, "codex"), "own");
});

test("reconciliation pins what the commands say and skips custom ones", () => {
  const rows = [
    { key: "claude", run: ["claude", "--dangerously-skip-permissions"] },
    { key: "codex", run: ["codex", "--no-daemon"] },
    { key: "gemini", run: ["gemini", "--yolo"] },
    { key: "grok", run: ["grok", "--permission-mode", "plan"] },
    { key: "pi", run: ["pi"] },
  ];
  // Nothing stored: what the files say becomes the visible state, without rewriting them.
  assert.deepEqual(reconcilePermissions(rows, { default: "own", overrides: {} }), {
    claude: "full-access",
    gemini: "full-access",
  });
  // A stored override that disagrees with the command is corrected; one that matches is kept.
  assert.deepEqual(
    reconcilePermissions(rows, { default: "own", overrides: { claude: "full-access", codex: "ask" } }),
    { claude: "full-access", gemini: "full-access" },
  );
  // Once the commands match the default, no override is left.
  assert.deepEqual(
    reconcilePermissions(rows, { default: "full-access", overrides: {} }),
    { codex: "own" },
  );
  // An agent that cannot express the default and adds no flag is not one of the person's exceptions.
  assert.deepEqual(
    reconcilePermissions(
      [{ key: "gemini", run: ["gemini"] }, { key: "codex", run: ["codex"] }],
      { default: "ask", overrides: {} },
    ),
    { codex: "own" },
  );
  // Picking a different permission for that agent is still an exception.
  assert.deepEqual(
    reconcilePermissions([{ key: "gemini", run: ["gemini", "--yolo"] }], { default: "ask", overrides: {} }),
    { gemini: "full-access" },
  );
});
