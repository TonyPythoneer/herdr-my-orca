import { test, vi } from "vite-plus/test";
import assert from "node:assert/strict";
import type { Context } from "gpui-kit";
import type { ExecResult } from "herdr";
import Changes from "../../../src/mods/orca-changes/main.js";

type Space = { active: boolean; folder: string; machine: string; id: string };

const dom = vi.hoisted(() => {
  class Node {
    declare nodes: unknown[];
    declare proxy: unknown;
    declare nodeId: string | undefined;
    declare nodeRole: string | undefined;
    declare label: string | undefined;
    declare tabIndex: number | undefined;
    declare click: (event: unknown, cx: unknown) => void;
    declare keydown: (event: unknown, cx: unknown) => void;
    constructor() {
      this.nodes = [];
    }
    child(value: unknown) {
      this.nodes.push(value);
      return this.proxy;
    }
    children(values: unknown[]) {
      this.nodes.push(...values);
      return this.proxy;
    }
    when(condition: unknown, fn: (el: unknown) => unknown) {
      return condition ? fn(this.proxy) : this.proxy;
    }
    id(value: string) {
      this.nodeId = value;
      return this.proxy;
    }
    role(value: string) {
      this.nodeRole = value;
      return this.proxy;
    }
    accessibility_label(value: string) {
      this.label = value;
      return this.proxy;
    }
    tab_index(value: number) {
      this.tabIndex = value;
      return this.proxy;
    }
    on_click(fn: (event: unknown, cx: unknown) => void) {
      this.click = fn;
      return this.proxy;
    }
    on_key_down(fn: (event: unknown, cx: unknown) => void) {
      this.keydown = fn;
      return this.proxy;
    }
    static make(): unknown {
      const node = new Node();
      node.proxy = new Proxy(node, {
        get(target, key) {
          return key in target ? Reflect.get(target, key) : () => node.proxy;
        },
      });
      return node.proxy;
    }
  }
  return { make: () => Node.make() };
});

const host = vi.hoisted(() => ({ spaces: (): Space[] => [] }));

vi.mock("gpui-kit", () => ({
  View: class {},
  div: () => dom.make(),
  svg: () => dom.make(),
}));
vi.mock("gpui-base", () => ({
  h_flex: () => dom.make(),
  v_flex: () => dom.make(),
}));
vi.mock("herdr", () => ({
  spaces: () => host.spaces(),
  exec: async (): Promise<ExecResult> => ({ code: 0, stdout: "", stderr: "" }),
}));

type Probe = {
  nodeId?: string;
  nodeRole?: string;
  label?: string;
  tabIndex?: number;
  click: (event: unknown, cx: unknown) => void;
  keydown: (event: unknown, cx: unknown) => void;
  nodes?: unknown[];
};

function asContext(value: unknown): Context {
  return value as Context;
}

function fixture() {
  let active: Space = { active: true, folder: "/repo", machine: "host", id: "space" };
  host.spaces = () => [active];
  const view = new Changes();
  const actions: unknown[][] = [];
  const handle = { is_focused: () => true };
  Object.assign(view, {
    root: "/repo",
    on: "host",
    context: JSON.stringify({ cwd: "/repo", on: "host", space: "space" }),
    files: [
      { section: "changes", path: "unstaged" },
      { section: "changes", path: "new", fresh: true },
      { section: "staged", path: "staged" },
      { section: "conflicts", path: "conflict" },
    ],
    collapsed: {},
    sectionViewFocus: { changes: handle, staged: handle },
    actionButton: () => dom.make(),
    fileRow: () => dom.make(),
    openDiff: (...args: unknown[]) => actions.push(args),
  });
  const find = (node: unknown, id: string): Probe | undefined => {
    const probe = node as Probe | undefined;
    return probe?.nodeId === id
      ? probe
      : probe?.nodes?.map((child) => find(child, id)).find(Boolean);
  };
  return {
    view,
    actions,
    find,
    setActive(value: Space) {
      active = value;
    },
  };
}

function asProbe(value: Probe | undefined): Probe {
  return value as Probe;
}

test("section View all opens only its own paths with mouse and keyboard", () => {
  const f = fixture(),
    cx = asContext({ notify() {}, stop_propagation() {} });
  const button = asProbe(f.find(f.view.section("changes", "Changes", {}, cx), "view-all-changes"));
  assert.equal(button.nodeRole, "button");
  assert.equal(button.label, "View all Changes");
  assert.equal(button.tabIndex, 0);
  button.click({}, cx);
  button.keydown({ key: "enter", modifiers: {} }, cx);
  button.keydown({ key: "enter", modifiers: { platform: true } }, cx);
  assert.equal(f.actions.length, 2);
  const first = f.actions[0] as [{ paths: string[]; section: string }, string, string];
  assert.deepEqual(Array.from(first[0].paths), ["unstaged", "new"]);
  assert.equal(first[0].section, "changes");
  assert.equal(first[1], "/repo");
  assert.equal(first[2], "host");
  const staged = asProbe(
    f.find(f.view.section("staged", "Staged Changes", {}, cx), "view-all-staged"),
  );
  staged.keydown({ key: "space", modifiers: {} }, cx);
  const third = f.actions[2] as [{ paths: string[] }];
  assert.deepEqual(Array.from(third[0].paths), ["staged"]);
  assert.equal(
    f.find(f.view.section("conflicts", "Conflicts", {}, cx), "view-all-conflicts"),
    undefined,
  );
  f.setActive({ active: true, folder: "/other", machine: "host", id: "other" });
  button.click({}, cx);
  assert.equal(f.actions.length, 3);
  assert.match(String(f.view.note), /changed/);
});
