import assert from "node:assert/strict";
import { test, vi } from "vite-plus/test";
import {
  agentPermissionItems,
  defaultPermissionItems,
  permissionSelect,
} from "../../../src/mods/orca-agent-settings/permission-menu.ts";
import type { PartsTheme } from "../../../src/mods/orca-agent-settings/parts.ts";
import { callsOf } from "../../stubs/gpui-kit";

vi.mock("gpui-base", async () => {
  const kit = await import("../../stubs/gpui-kit");
  return {
    v_flex: () => kit.div(),
    h_flex: () => kit.div(),
    Popover: { new: (id: string) => kit.div().id(id) },
  };
});

const owner = (def: string) => ({ permissions: { default: def, overrides: {} } });
const row = (key: string, permission: string, permissionOverride = false) => ({
  key,
  name: key,
  permission,
  permissionOverride,
});
const selected = (items: { id: string; selected: boolean }[]) =>
  items.filter((item) => item.selected).map((item) => item.id);

test("a following agent selects Same as all agents", () => {
  assert.deepEqual(
    selected(agentPermissionItems(owner("full-access"), row("claude", "full-access"))),
    ["default"],
  );
  assert.deepEqual(selected(agentPermissionItems(owner("own"), row("claude", "own"))), ["default"]);
});

test("an explicit override selects its own choice, not the inherited item", () => {
  assert.deepEqual(
    selected(agentPermissionItems(owner("own"), row("claude", "full-access", true))),
    ["full-access"],
  );
  assert.deepEqual(selected(agentPermissionItems(owner("ask"), row("claude", "own", true))), [
    "own",
  ]);
});

test("an agent that cannot express the all-agents choice still shows one selection", () => {
  const items = agentPermissionItems(owner("ask"), row("amp", "own"));
  assert.equal(
    items.some((item) => item.id === "default"),
    false,
  );
  assert.deepEqual(selected(items), ["own"]);
  assert.deepEqual(selected(agentPermissionItems(owner("full-access"), row("opencode", "own"))), [
    "own",
  ]);
});

test("a command with its own flags selects nothing and offers every supported choice", () => {
  const items = agentPermissionItems(owner("own"), row("claude", "custom"));
  assert.deepEqual(selected(items), []);
  assert.deepEqual(
    items.map((item) => item.id),
    ["default", "ask", "auto", "full-access", "own"],
  );
});

test("only supported choices are offered, with the agent's own settings last after a rule", () => {
  const items = agentPermissionItems(owner("own"), row("amp", "own"));
  assert.deepEqual(
    items.map((item) => item.id),
    ["default", "full-access", "own"],
  );
  assert.equal(items.at(-1)!.label, "Use amp's own settings");
  assert.equal(items.at(-1)!.separator, true);
});

test("the global menu lists ask, approve, full access, then own after a rule", () => {
  const items = defaultPermissionItems(owner("ask"), []);
  assert.deepEqual(
    items.map((item) => item.id),
    ["ask", "auto", "full-access", "own"],
  );
  assert.deepEqual(
    items.map((item) => Boolean(item.separator)),
    [false, false, false, true],
  );
  assert.deepEqual(selected(items), ["ask"]);
});

test("picking an item calls the owner's permission method with its choice", () => {
  const setDefaultPermission = vi.fn();
  const setAgentPermission = vi.fn();
  const withActions = { ...owner("ask"), setDefaultPermission, setAgentPermission };
  const cx = {};
  defaultPermissionItems(withActions, [])[2].onPick(cx);
  assert.deepEqual(setDefaultPermission.mock.calls, [["full-access", cx]]);
  const agent = row("codex", "ask");
  agentPermissionItems(withActions, agent).at(-1)?.onPick(cx);
  assert.deepEqual(setAgentPermission.mock.calls, [[agent, "own", cx]]);
});

type SelectSpec =Parameters<typeof permissionSelect>[0];

const theme: PartsTheme = {
  muted: "#101010",
  border: "#202020",
  accent: "#303030",
  foreground: "#404040",
  background: "#505050",
  surface: "#606060",
  input: "#707070",
  ring: "#808080",
  blocked: "#909090",
  hover: "#a0a0a0",
  raised: "#b0b0b0",
  dim: "#c0c0c0",
  popover: "#d0d0d0",
  done: "#e0e0e0",
};

const menuItems: SelectSpec["items"] = [
  {
    id: "default",
    label: "Same as all agents",
    choice: null,
    suffix: { choice: "ask", label: "Ask" },
    selected: true,
    onPick: () => undefined,
  },
  {
    id: "ask",
    label: "Ask",
    description: "Ask before each action",
    choice: "ask",
    selected: false,
    separator: true,
    onPick: () => undefined,
  },
  {
    id: "own",
    label: "Use claude's own settings",
    choice: "own",
    detail: "Terminal only",
    selected: false,
    onPick: () => undefined,
  },
];

function selectSpec(overrides: Partial<SelectSpec> = {}): SelectSpec {
  return {
    id: "claude",
    label: "Claude",
    choice: "ask",
    open: true,
    active: 1,
    items: menuItems,
    onOpenChange: () => undefined,
    ...overrides,
  };
}

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

function argsOf(element: object, name: string): unknown[] {
  return callsOf(element).find(([method]) => method === name)?.[1] ?? [];
}

function elementArg(element: object, name: string): object {
  const value = argsOf(element, name)[0];
  if (!isObject(value)) throw new Error(`${name} is not an element`);
  return value;
}

function childElements(element: object): object[] {
  return callsOf(element)
    .filter(([method]) => method === "child")
    .map(([, args]) => args[0])
    .filter(isObject);
}

function childrenOf(element: object): object[] {
  const value = argsOf(element, "children")[0];
  return Array.isArray(value) ? value.filter(isObject) : [];
}

function rowOf(item: object): object {
  return childElements(item).at(-1) ?? item;
}

test("permissionSelect is a popover anchored top right around its trigger", () => {
  const popover = permissionSelect(selectSpec(), theme);
  assert.deepEqual(argsOf(popover, "id"), ["am-perm-pop-claude"]);
  assert.deepEqual(argsOf(popover, "anchor"), ["top_right"]);
  assert.deepEqual(argsOf(popover, "open"), [true]);
  assert.deepEqual(argsOf(elementArg(popover, "trigger"), "id"), ["am-perm-claude"]);
});

test("the menu is 320 wide unless the spec gives a width", () => {
  const defaultMenu = elementArg(permissionSelect(selectSpec(), theme), "content");
  const wideMenu = elementArg(permissionSelect(selectSpec({ width: 360 }), theme), "content");
  assert.deepEqual(argsOf(defaultMenu, "w"), [320]);
  assert.deepEqual(argsOf(wideMenu, "w"), [360]);
});

test("the trigger is labelled for its agent and explains the choice in a tooltip", () => {
  const trigger = elementArg(permissionSelect(selectSpec(), theme), "trigger");
  assert.deepEqual(argsOf(trigger, "accessibility_label"), ["Claude: choose permission"]);
  assert.deepEqual(argsOf(trigger, "tooltip"), [
    "Choose how much this agent may do without asking",
  ]);
});

test("the trigger icon follows the choice, and custom shares the own-settings asset", () => {
  const iconFor = (choice: string) =>
    childElements(elementArg(permissionSelect(selectSpec({ choice }), theme), "trigger"))[0];
  assert.deepEqual(Reflect.get(iconFor("ask"), "args"), ["mods/orca-assets/hand.svg"]);
  assert.deepEqual(Reflect.get(iconFor("full-access"), "args"), [
    "mods/orca-assets/shield-alert.svg",
  ]);
  assert.deepEqual(Reflect.get(iconFor("own"), "args"), [
    "mods/orca-assets/square-terminal--orca-agent-settings.svg",
  ]);
  assert.deepEqual(Reflect.get(iconFor("custom"), "args"), [
    "mods/orca-assets/square-terminal--orca-agent-settings.svg",
  ]);
});

test("opening or closing the popover reports the new state to the spec", () => {
  const changes: unknown[][] = [];
  const cx = { notify: () => undefined };
  const popover = permissionSelect(
    selectSpec({
      onOpenChange: (open, context) => {
        changes.push([open, context]);
      },
    }),
    theme,
  );
  const handler: unknown = argsOf(popover, "on_open_change")[0];
  if (typeof handler !== "function") throw new Error("on_open_change is not a handler");
  handler(false, cx);
  assert.deepEqual(changes, [[false, cx]]);
});

test("each menu item is a labelled button, and only the active index is highlighted", () => {
  const menu = elementArg(permissionSelect(selectSpec({ active: 1 }), theme), "content");
  const rows = childrenOf(menu).map(rowOf);
  assert.equal(rows.length, 3);
  assert.deepEqual(
    rows.map((row) => argsOf(row, "id")),
    [["am-perm-claude-default"], ["am-perm-claude-ask"], ["am-perm-claude-own"]],
  );
  assert.deepEqual(
    rows.map((row) => argsOf(row, "accessibility_label")),
    [["Same as all agents"], ["Ask"], ["Use claude's own settings"]],
  );
  assert.deepEqual(
    rows.map((row) => argsOf(row, "bg")),
    [["#00000000"], [theme.hover], ["#00000000"]],
  );
  assert.deepEqual(
    rows.map((row) => argsOf(row, "role")),
    [["button"], ["button"], ["button"]],
  );
});

test("an item with a separator draws its rule above the row", () => {
  const menu = elementArg(permissionSelect(selectSpec(), theme), "content");
  const [first, second] = childrenOf(menu);
  assert.equal(childElements(first).length, 1);
  assert.equal(childElements(second).length, 2);
});
