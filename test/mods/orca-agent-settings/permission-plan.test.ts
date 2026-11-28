import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import {
  defaultPermissionNotice,
  permissionSummary,
  planDefaultPermission,
  type PermissionRow,
} from "../../../src/mods/orca-agent-settings/permission-plan.js";
import type {
  Permissions,
  StoredPermission,
} from "../../../src/mods/orca-agent-settings/permissions.js";

function row(
  key: string,
  name: string,
  run: string[],
  permission: StoredPermission,
  permissionOverride = false,
): PermissionRow {
  return { key, name, run, permission, permissionOverride };
}

function permissions(value: Permissions["default"]): Permissions {
  return { default: value, overrides: {} };
}

test("planDefaultPermission writes the choice into a row that takes it", () => {
  const plan = planDefaultPermission([row("claude", "Claude", ["claude"], "own")], "ask");
  assert.deepEqual(plan, {
    runs: new Map([["claude", ["claude", "--permission-mode", "default"]]]),
    applied: 1,
    unsupported: 0,
    custom: 0,
  });
});

test("planDefaultPermission replaces the flags a row already has", () => {
  const plan = planDefaultPermission(
    [row("claude", "Claude", ["claude", "--permission-mode", "default"], "ask")],
    "full-access",
  );
  assert.deepEqual(plan, {
    runs: new Map([["claude", ["claude", "--dangerously-skip-permissions"]]]),
    applied: 1,
    unsupported: 0,
    custom: 0,
  });
});

test("planDefaultPermission leaves a row alone when it already carries the choice", () => {
  const plan = planDefaultPermission(
    [row("claude", "Claude", ["claude", "--permission-mode", "auto"], "auto")],
    "auto",
  );
  assert.deepEqual(plan, { runs: new Map(), applied: 1, unsupported: 0, custom: 0 });
});

test("own strips the choice flags and keeps the rest of the command", () => {
  const plan = planDefaultPermission(
    [row("claude", "Claude", ["claude", "--permission-mode", "auto", "--verbose"], "auto")],
    "own",
  );
  assert.deepEqual(plan, {
    runs: new Map([["claude", ["claude", "--verbose"]]]),
    applied: 1,
    unsupported: 0,
    custom: 0,
  });
});

test("planDefaultPermission skips custom rows and counts them", () => {
  const plan = planDefaultPermission(
    [
      row("claude", "Claude", ["claude", "--permission-mode", "default", "--x"], "custom"),
      row("codex", "Codex", ["codex"], "own"),
    ],
    "full-access",
  );
  assert.deepEqual(plan, {
    runs: new Map([["codex", ["codex", "--dangerously-bypass-approvals-and-sandbox"]]]),
    applied: 1,
    unsupported: 0,
    custom: 1,
  });
});

test("planDefaultPermission counts agents that cannot express the choice as unsupported", () => {
  const plan = planDefaultPermission(
    [
      row("opencode", "OpenCode", ["opencode"], "own"),
      row("mystery", "Mystery", ["mystery"], "own"),
    ],
    "ask",
  );
  assert.deepEqual(plan, { runs: new Map(), applied: 0, unsupported: 2, custom: 0 });
});

test("planDefaultPermission counts a row with no command as unsupported", () => {
  assert.deepEqual(planDefaultPermission([row("claude", "Claude", [], "own")], "ask"), {
    runs: new Map(),
    applied: 0,
    unsupported: 1,
    custom: 0,
  });
  assert.deepEqual(planDefaultPermission([row("claude", "Claude", [], "own")], "own"), {
    runs: new Map(),
    applied: 0,
    unsupported: 1,
    custom: 0,
  });
});

test("planDefaultPermission returns an empty plan for no rows", () => {
  assert.deepEqual(planDefaultPermission([], "ask"), {
    runs: new Map(),
    applied: 0,
    unsupported: 0,
    custom: 0,
  });
});

test("defaultPermissionNotice reads the applied count in the singular and plural", () => {
  assert.equal(
    defaultPermissionNotice({ applied: 1, unsupported: 0, custom: 0 }),
    "Applied to 1 agent.",
  );
  assert.equal(
    defaultPermissionNotice({ applied: 0, unsupported: 0, custom: 0 }),
    "Applied to 0 agents.",
  );
});

test("defaultPermissionNotice lists unsupported and custom agents when present", () => {
  assert.equal(
    defaultPermissionNotice({ applied: 2, unsupported: 1, custom: 1 }),
    "Applied to 2 agents; 1 don't support this setting; 1 uses custom launch arguments.",
  );
  assert.equal(
    defaultPermissionNotice({ applied: 3, unsupported: 2, custom: 2 }),
    "Applied to 3 agents; 2 don't support this setting; 2 use custom launch arguments.",
  );
  assert.equal(
    defaultPermissionNotice({ applied: 0, unsupported: 2, custom: 0 }),
    "Applied to 0 agents; 2 don't support this setting.",
  );
});

test("permissionSummary reports exceptions, custom rows and agents without the choice", () => {
  const summary = permissionSummary(
    [
      row("claude", "Claude", ["claude"], "ask", true),
      row("codex", "Codex", ["codex"], "custom"),
      row("opencode", "OpenCode", ["opencode"], "own"),
      row("mystery", "Mystery", ["mystery"], "full-access"),
    ],
    permissions("full-access"),
  );
  assert.deepEqual(summary, {
    exceptions: 1,
    custom: 1,
    exceptionLine: "1 agent keeps its own permission: Claude (Ask for approval).",
    customLine:
      "1 agent sets permission flags in its own command; changing the default leaves it alone.",
    noChoiceLine:
      "2 agents have no Full access flag and keep their own command: OpenCode, Mystery.",
  });
});

test("permissionSummary pluralizes exceptions and custom rows", () => {
  const summary = permissionSummary(
    [
      row("claude", "Claude", ["claude"], "ask", true),
      row("codex", "Codex", ["codex"], "full-access", true),
      row("gemini", "Gemini", ["gemini"], "custom"),
      row("grok", "Grok", ["grok"], "custom"),
    ],
    permissions("full-access"),
  );
  assert.equal(summary.exceptions, 2);
  assert.equal(summary.custom, 2);
  assert.equal(
    summary.exceptionLine,
    "2 agents keep their own permission: Claude (Ask for approval), Codex (Full access).",
  );
  assert.equal(
    summary.customLine,
    "2 agents set permission flags in its own command; changing the default leaves them alone.",
  );
  assert.equal(summary.noChoiceLine, null);
});

test("permissionSummary names at most three agents without the choice", () => {
  const summary = permissionSummary(
    [
      row("amp", "Amp", ["amp"], "own"),
      row("copilot", "Copilot", ["copilot"], "own"),
      row("cursor", "Cursor", ["cursor"], "own"),
      row("gemini", "Gemini", ["gemini"], "own"),
    ],
    permissions("auto"),
  );
  assert.equal(
    summary.noChoiceLine,
    "4 agents have no Approve for me flag and keep their own command: Amp, Copilot, Cursor +1.",
  );
});

test("permissionSummary reads a single agent without the choice in the singular", () => {
  const summary = permissionSummary(
    [row("opencode", "OpenCode", ["opencode"], "own")],
    permissions("full-access"),
  );
  assert.deepEqual(summary, {
    exceptions: 0,
    custom: 0,
    exceptionLine: null,
    customLine: null,
    noChoiceLine: "1 agent has no Full access flag and keeps its own command: OpenCode.",
  });
});

test("permissionSummary has no no-choice line when the default is each agent's own", () => {
  const summary = permissionSummary(
    [
      row("mystery", "Mystery", ["mystery"], "own"),
      row("claude", "Claude", ["claude"], "own", true),
    ],
    permissions("own"),
  );
  assert.deepEqual(summary, {
    exceptions: 1,
    custom: 0,
    exceptionLine: "1 agent keeps its own permission: Claude (Each agent's own settings).",
    customLine: null,
    noChoiceLine: null,
  });
});

test("permissionSummary is empty for no managed agents", () => {
  assert.deepEqual(permissionSummary([], permissions("full-access")), {
    exceptions: 0,
    custom: 0,
    exceptionLine: null,
    customLine: null,
    noChoiceLine: null,
  });
});
