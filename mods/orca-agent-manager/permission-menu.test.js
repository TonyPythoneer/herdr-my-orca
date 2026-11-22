// The per-agent menu must always mark exactly one item, whatever the all-agents choice is.
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register(new URL("../../scripts/gpui-stub-loader.mjs", import.meta.url));
const { agentPermissionItems, defaultPermissionItems } = await import("./permission-menu.js");

const owner = (def) => ({ permissions: { default: def, overrides: {} } });
const row = (key, permission, permissionOverride = false) => ({ key, name: key, permission, permissionOverride });
const selected = (items) => items.filter((item) => item.selected).map((item) => item.id);

test("a following agent selects Same as all agents", () => {
  assert.deepEqual(selected(agentPermissionItems(owner("full-access"), row("claude", "full-access"))), ["default"]);
  assert.deepEqual(selected(agentPermissionItems(owner("own"), row("claude", "own"))), ["default"]);
});

test("an explicit override selects its own choice, not the inherited item", () => {
  assert.deepEqual(selected(agentPermissionItems(owner("own"), row("claude", "full-access", true))), ["full-access"]);
  assert.deepEqual(selected(agentPermissionItems(owner("ask"), row("claude", "own", true))), ["own"]);
});

test("an agent that cannot express the all-agents choice still shows one selection", () => {
  const items = agentPermissionItems(owner("ask"), row("amp", "own"));
  assert.equal(items.some((item) => item.id === "default"), false);
  assert.deepEqual(selected(items), ["own"]);
  assert.deepEqual(selected(agentPermissionItems(owner("full-access"), row("opencode", "own"))), ["own"]);
});

test("a command with its own flags selects nothing and offers every supported choice", () => {
  const items = agentPermissionItems(owner("own"), row("claude", "custom"));
  assert.deepEqual(selected(items), []);
  assert.deepEqual(items.map((item) => item.id), ["default", "ask", "auto", "full-access", "own"]);
});

test("only supported choices are offered, with the agent's own settings last after a rule", () => {
  const items = agentPermissionItems(owner("own"), row("amp", "own"));
  assert.deepEqual(items.map((item) => item.id), ["default", "full-access", "own"]);
  assert.equal(items.at(-1).label, "Use amp's own settings");
  assert.equal(items.at(-1).separator, true);
});

test("the global menu lists ask, approve, full access, then own after a rule", () => {
  const items = defaultPermissionItems(owner("ask"), []);
  assert.deepEqual(items.map((item) => item.id), ["ask", "auto", "full-access", "own"]);
  assert.deepEqual(items.map((item) => Boolean(item.separator)), [false, false, false, true]);
  assert.deepEqual(selected(items), ["ask"]);
});
