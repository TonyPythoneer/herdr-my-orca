import assert from "node:assert/strict";
import { beforeEach, vi } from "vite-plus/test";
import type { AsyncContext, Context } from "gpui-kit";
import { goldenSuite } from "./golden.js";
import { diffBody, type DiffBodyTheme } from "../../../src/mods/orca-diff/diff.js";
import type { DiffRow } from "../../../src/mods/orca-diff/diff-rows.js";
import type { DiffTarget } from "../../../src/mods/orca-diff/diff-data.js";
import Diff from "../../../src/mods/orca-diff/main.js";
import { fake, handler, nodeOrValue, resetHost, world } from "./host.js";

vi.mock("gpui-kit", async () => (await import("./host.js")).gpuiKit());
vi.mock("gpui-base", async () => (await import("./host.js")).gpuiBase());
vi.mock("herdr", async () => (await import("./host.js")).herdr());

beforeEach(() => {
  resetHost();
});

function view(
  target: DiffTarget | null,
  rows: DiffRow[] = [],
  props: Record<string, unknown> = {},
): Diff {
  world.props = props;
  const v = new Diff();
  v.target = target;
  v.rows = rows;
  v.width = 300;
  v.loadGeneration = 0;
  return v;
}

const ROWS: DiffRow[] = [
  { kind: "F", text: "file" },
  { kind: "@", text: "@@ -1 +1 @@" },
  { kind: " ", number: 1, text: "ctx" },
  { kind: "-", number: 2, text: "old" },
  { kind: "+", number: 2, text: "new" },
  { kind: "+", number: 3, text: "new2" },
  { kind: "", text: "plain" },
];

goldenSuite(
  "diff-view",
  {
    "the pane renders an empty prompt, and each target with its counts and badge": async () => {
      const out: Record<string, unknown> = {
        empty: nodeOrValue(view(null).render(fake<Context>({}))),
      };
      for (const [name, target] of Object.entries({
        all: { all: true },
        staged: { sectionAll: true, section: "staged" },
        changes: { sectionAll: true },
        untracked: { path: "a/b/c.txt", status: "U" },
        stagedFile: { path: "d/e", section: "staged" },
        plain: { path: "top" },
      })) {
        out[name] = nodeOrValue(
          view(target, name === "plain" ? [] : ROWS).render(fake<Context>({})),
        );
      }
      world.settings = { font_family: "Fira" };
      out.font = nodeOrValue(view({ path: "p" }, ROWS).render(fake<Context>({})));
      world.settings = {};
      return out;
    },
    "the diff body draws each row kind through a virtual list": async () => {
      const out: Record<string, unknown> = {};
      const theme: DiffBodyTheme = {
        raised: "#222222",
        dim: "#333333",
        selected: "#444444",
        foreground: "#555555",
        ansi1: "#aa0000",
        ansi2: "#00aa00",
      };
      out.body = nodeOrValue(diffBody(theme, "Mono", ROWS, 640));
      const renderRows = world.virtual;
      assert.ok(renderRows);
      out.rows = renderRows({ start: 0, end: ROWS.length }).map(nodeOrValue);
      out.window = renderRows({ start: 2, end: 4 }).map(nodeOrValue);
      return out;
    },
    "closing the diff pane closes only this tab's single diff pane": async () => {
      const out: Record<string, unknown> = {};
      const close = (panes: unknown[], focused: unknown): unknown[][] => {
        world.panes = panes;
        world.focused = focused;
        world.runs.length = 0;
        const v = view({ path: "p" }, ROWS);
        v.render(fake<Context>({}));
        handler("orca-diff-close", "on_click")!();
        return world.runs.slice();
      };
      out.one = close(
        [
          { mod: "orca-diff", tab: 1, pane: "p1" },
          { mod: "term", tab: 1, pane: "p2" },
          { mod: "orca-diff", tab: 2, pane: "p3" },
        ],
        { tab: 1 },
      );
      out.two = close(
        [
          { mod: "orca-diff", tab: 1, pane: "p1" },
          { mod: "orca-diff", tab: 1, pane: "p4" },
        ],
        { tab: 1 },
      );
      out.none = close([{ mod: "term", tab: 1, pane: "p2" }], { tab: 1 });
      out.noFocus = close([{ mod: "orca-diff", tab: undefined, pane: "p1" }], null);
      return out;
    },
    "the pane loads its target on init, ignores a stale result and keeps the newest rows":
      async () => {
        const out: Record<string, unknown> = {};
        const exec = world.exec;
        const timers: Array<[number, (cx: AsyncContext) => void]> = [];
        const c = fake<AsyncContext>({
          notify() {
            world.notifies++;
          },
          spawn(body: (cx: AsyncContext) => unknown) {
            const job = Promise.resolve(body(c));
            world.jobs.push(job);
            return job;
          },
          timer: {
            every(ms: number, fn: (cx: AsyncContext) => void) {
              timers.push([ms, fn]);
            },
          },
        });
        world.props = { root: "/r", path: "a" };
        let release: () => void = () => {};
        world.exec = () =>
          new Promise((resolve) => {
            release = () => resolve({ code: 0, stdout: "@@ -1 +1 @@\n+first\n", stderr: "" });
          });
        world.waitForCommand = true;
        const v = new Diff();
        v.init({}, c);
        const stale = release;
        world.exec = async () => ({
          code: 0,
          stdout: "@@ -1 +1 @@\n+second\n",
          stderr: "",
        });
        v.load(c);
        await new Promise<void>((resolve) => setImmediate(resolve));
        stale();
        await new Promise<void>((resolve) => setImmediate(resolve));
        out.rows = v.rows.map((r) => r.text);
        out.width = v.width;
        out.timer = timers.map(([ms]) => ms);
        v.target = null;
        v.load(c);
        out.noTarget = v.rows.length;
        world.props = {};
        const bare = new Diff();
        bare.init({}, c);
        out.bare = bare.target;
        world.exec = exec;
        return out;
      },
  },
  import.meta.url,
);
