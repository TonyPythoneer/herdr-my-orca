import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { beforeEach, test, vi } from "vite-plus/test";
import PanelHead from "../../../src/mods/orca-right-sidebar-header/main.ts";
import { VIEW_REVEALS } from "../../../src/mods/orca-right-sidebar-header/panel-views.ts";

type RecordedNode = { n: string; a: unknown[]; c: [string, unknown][] };
type Spawn = (cx: { notify: () => void }) => unknown;
type Golden = {
  locations: Record<string, unknown>;
  tools: { byState: Record<string, string[]> };
  render: Record<string, RecordedNode>;
};

const harness = vi.hoisted(() => {
  type Node = { __node: RecordedNode };
  type Builder = Node & Record<string, unknown>;
  const state = {
    calls: [] as Array<[string, unknown[]]>,
    spawned: [] as Spawn[],
    exec: vi.fn(
      async (
        _command: string,
        _args: string[],
        _options: { cwd?: string; on?: string | null },
      ) => ({
        code: 0,
        stdout: "/repo\n",
        stderr: "",
      }),
    ),
    spaces: null as unknown,
    panes: null as unknown,
    focus: null as unknown,
    layout: null as unknown,
    commandQueue: [] as Array<string | null>,
    notifications: 0,
  };
  const clean = (value: unknown): unknown => {
    if (typeof value === "function") return "fn";
    if (value && typeof value === "object") {
      const node = (value as Node).__node;
      if (node) return node;
      if (Array.isArray(value)) return value.map(clean);
      return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, clean(child)]));
    }
    return value;
  };
  const element = (name: string, args: unknown[] = []): Builder => {
    const recorded: RecordedNode = { n: name, a: args.map(clean), c: [] };
    const proxy = new Proxy({ __node: recorded } as Builder, {
      get(target, key) {
        if (key === "__node") return target.__node;
        if (key === "then" || typeof key === "symbol") return undefined;
        return (...values: unknown[]) => {
          state.calls.push([String(key), values]);
          if (key === "when") {
            if (values[0]) (values[1] as (node: Builder) => unknown)(proxy);
            return proxy;
          }
          if (key === "hover") {
            const hover = element("hover");
            (values[0] as (node: Builder) => unknown)(hover);
            recorded.c.push(["hover", hover.__node]);
            return proxy;
          }
          recorded.c.push([String(key), values.map(clean)]);
          return proxy;
        };
      },
    });
    return proxy;
  };
  return { state, element };
});

vi.mock("gpui-kit", () => ({
  View: class {},
  div: () => harness.element("div"),
  svg: (path: string) => harness.element("svg", [path]),
}));
vi.mock("gpui-base", () => ({
  Button: { new: (id: string) => harness.element("Button.new", [id]) },
  h_flex: () => harness.element("h_flex"),
}));
vi.mock("herdr", () => ({
  theme: () => ({ foreground: "#112233", muted: "#muted" }),
  run: (name: string, args?: unknown) => harness.state.calls.push([name, [args]]),
  layout: () => harness.state.layout,
  panes: () => harness.state.panes,
  spaces: () => harness.state.spaces,
  focused: () => harness.state.focus,
  exec: (...args: Parameters<typeof harness.state.exec>) => harness.state.exec(...args),
  nextCommand: () => {
    const command = harness.state.commandQueue.shift();
    return command === undefined
      ? new Promise<string>(() => {})
      : Promise.resolve(command as string);
  },
}));

const GOLDEN = JSON.parse(
  readFileSync(new URL("./render.golden.json", import.meta.url), "utf8"),
) as Golden;
const REPO = { code: 0, stdout: "/repo\n", stderr: "" };
const NOT_REPO = { code: 128, stdout: "", stderr: "fatal" };
const PROBE_TTL = 5000;
let now = 1_000_000;

function folderOf(id: string, folder: string, machine: string | null = null) {
  return { id, folder, machine, active: true };
}

function context() {
  return {
    spawn: (job: Spawn) => {
      harness.state.spawned.push(job);
      return undefined;
    },
    notify: () => {
      harness.state.notifications += 1;
    },
  } as never;
}

function render() {
  return new PanelHead().render(context()) as unknown as { __node: RecordedNode };
}

function record(node: unknown): unknown {
  if (node && typeof node === "object" && "__node" in node)
    return (node as { __node: RecordedNode }).__node;
  return node;
}

function descend(node: unknown, predicate: (value: RecordedNode) => boolean): RecordedNode | null {
  if (!node || typeof node !== "object") return null;
  const current = record(node);
  if (!current || typeof current !== "object" || !("n" in current)) return null;
  const typed = current as RecordedNode;
  if (predicate(typed)) return typed;
  for (const [, args] of typed.c) {
    const found = descend(args, predicate);
    if (found) return found;
  }
  return null;
}

function buttons(node = record(render())): RecordedNode[] {
  const found: RecordedNode[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== "object") return;
    const raw = record(value);
    if (!raw || typeof raw !== "object" || !("n" in raw)) return;
    const typed = raw as RecordedNode;
    if (typed.n === "Button.new") found.push(typed);
    typed.c.forEach(([, args]) => visit(args));
  };
  visit(node);
  return found;
}

function buttonIds(node?: unknown): string[] {
  return buttons(node).map((button) => String(button.a[0]).replace(/^panel-/, ""));
}

async function drain(job: Spawn): Promise<void> {
  await job({
    notify: () => {
      harness.state.notifications += 1;
    },
  });
}

function arrange({
  spaces = [],
  panes = [],
  focus = null,
  active = "files",
  layoutPresent = true,
}: {
  spaces?: unknown;
  panes?: unknown;
  focus?: unknown;
  active?: string;
  layoutPresent?: boolean;
} = {}): void {
  harness.state.spaces = spaces;
  harness.state.panes = panes;
  harness.state.focus = focus;
  harness.state.layout = layoutPresent
    ? { id: "root", children: [{ id: "panel-body", active }] }
    : undefined;
}

beforeEach(() => {
  harness.state.calls.length = 0;
  harness.state.spawned.length = 0;
  harness.state.notifications = 0;
  harness.state.commandQueue.length = 0;
  harness.state.exec.mockReset();
  harness.state.exec.mockResolvedValue(REPO);
  now = 1_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  arrange();
  render();
});

test("all 13 working-directory locations match the legacy golden", async () => {
  const locations: Record<
    string,
    {
      spaces?: unknown[] | null;
      panes?: unknown[] | null;
      focus?: unknown;
    }
  > = {
    noSpaceNoFocus: { spaces: null, panes: null },
    paneCwd: {
      spaces: [folderOf("s1", "/proj")],
      focus: { pane: "p1", cwd: "/ignored" },
      panes: [{ pane: "p1", cwd: "/proj/src" }],
    },
    focusCwdOnly: { spaces: [folderOf("s1", "/proj")], focus: { pane: "p9", cwd: "/proj/lib" } },
    outsideProject: {
      spaces: [folderOf("s1", "/proj")],
      focus: { pane: "p1" },
      panes: [{ pane: "p1", cwd: "/tmp" }],
    },
    siblingPrefix: {
      spaces: [folderOf("s1", "/proj")],
      focus: { pane: "p1" },
      panes: [{ pane: "p1", cwd: "/proj2" }],
    },
    sameAsProject: {
      spaces: [folderOf("s1", "/proj")],
      focus: { pane: "p1" },
      panes: [{ pane: "p1", cwd: "/proj" }],
    },
    projectOnly: { spaces: [folderOf("s1", "/proj")] },
    liveOnly: { focus: { pane: "p1", cwd: "/live" } },
    spaceMachine: { spaces: [folderOf("s1", "/proj", "box")], focus: { pane: "p1", cwd: "/proj" } },
    hostTerminal: {
      spaces: [folderOf("s1", "/proj")],
      focus: { pane: null, terminal: "hostA/term", cwd: "/remote" },
    },
    hostTerminalNoSlash: {
      spaces: [folderOf("s1", "/proj")],
      focus: { pane: null, terminal: "term", cwd: "/remote" },
    },
    hostTerminalNone: { spaces: [folderOf("s1", "/proj")], focus: { pane: null, cwd: "/remote" } },
    inactiveSpaceIgnored: {
      spaces: [{ id: "s2", folder: "/other", machine: null, active: false }],
      focus: { pane: "p1", cwd: "/live" },
    },
  };
  for (const [name, scenario] of Object.entries(locations)) {
    arrange();
    renderWithContext(context());
    arrange(scenario);
    harness.state.spawned.length = 0;
    harness.state.exec.mockClear();
    const cx = context();
    renderWithContext(cx);
    for (const job of harness.state.spawned.splice(0)) await drain(job);
    const probe = harness.state.exec.mock.calls[0];
    const seen = probe ? { cmd: probe[0], tail: probe[1].slice(-2), options: probe[2] } : null;
    assert.deepEqual(seen, GOLDEN.locations[name], name);
    harness.state.spawned.length = 0;
  }
});

function renderWithContext(cx: ReturnType<typeof context>): void {
  new PanelHead().render(cx);
}

test("repo, folder, and SSH tool IDs match the legacy golden", async () => {
  const shown: Record<string, string[]> = {};
  const states = [
    ["repo", REPO, { spaces: [folderOf("s1", "/repo")], focus: { pane: "p1", cwd: "/repo" } }],
    [
      "folder",
      NOT_REPO,
      { spaces: [folderOf("s1", "/folder")], focus: { pane: "p1", cwd: "/folder" } },
    ],
    [
      "sshRepo",
      REPO,
      { spaces: [folderOf("s1", "/ssh", "box")], focus: { pane: "p1", cwd: "/ssh" } },
    ],
    [
      "hostTerminal",
      REPO,
      {
        ...{
          spaces: [folderOf("s1", "/host")],
          focus: { pane: null, terminal: "hostA/term", cwd: "/host" },
        },
      },
    ],
  ] as const;
  for (const [name, answer, scenario] of states) {
    arrange(scenario);
    harness.state.exec.mockResolvedValue(answer);
    harness.state.spawned.length = 0;
    renderWithContext(context());
    const probe = harness.state.spawned.shift();
    if (probe) await drain(probe);
    shown[name] = buttonIds(record(renderWithContextResult()));
  }
  assert.deepEqual(shown, GOLDEN.tools.byState);
});

function renderWithContextResult(): unknown {
  return render();
}

test("render trees match legacy goldens for folder and repo states", async () => {
  const states = [
    ["folderFilesActive", NOT_REPO, "files"],
    ["folderWorkspacesActive", NOT_REPO, "workspaces"],
    ["repoChangesActive", REPO, "changes"],
  ] as const;
  for (const [name, answer, active] of states) {
    arrange({
      spaces: [folderOf("s1", `/golden-${name}`, "box")],
      panes: [{ pane: "p1", cwd: `/golden-${name}` }],
      focus: { pane: "p1", cwd: `/golden-${name}` },
      active,
    });
    harness.state.exec.mockResolvedValue(answer);
    harness.state.spawned.length = 0;
    render();
    const probe = harness.state.spawned.shift();
    if (probe) await drain(probe);
    assert.deepEqual(record(render()), GOLDEN.render[name], name);
  }
});

test("a rejected git probe resolves as a folder and repaints once", async () => {
  arrange({ spaces: [folderOf("s1", "/reject")], focus: { pane: "p1", cwd: "/reject" } });
  harness.state.exec.mockRejectedValue(new Error("spawn failed"));
  harness.state.spawned.length = 0;
  render();
  assert.ok(buttonIds(record(render())).includes("changes"));
  const probe = harness.state.spawned.shift();
  assert.ok(probe);
  await drain(probe!);
  assert.equal(harness.state.notifications, 1);
  assert.ok(buttonIds(record(render())).includes("workspaces"));
});

test("git probes use the complete read-only command arguments", async () => {
  arrange({ spaces: [folderOf("s1", "/read-only")], focus: { pane: "p1", cwd: "/read-only" } });
  harness.state.spawned.length = 0;
  render();
  const probe = harness.state.spawned.shift();
  assert.ok(probe);
  await drain(probe!);
  assert.deepEqual(harness.state.exec.mock.calls[0], [
    "git",
    [
      "--no-optional-locks",
      "-c",
      "core.fsmonitor=false",
      "-c",
      "diff.autoRefreshIndex=false",
      "rev-parse",
      "--show-toplevel",
    ],
    { cwd: "/read-only", on: null },
  ]);
});

test("git probe cache expires after five seconds and repaints only when its answer changes", async () => {
  arrange({ spaces: [folderOf("s1", "/cache")], focus: { pane: "p1", cwd: "/cache" } });
  harness.state.exec
    .mockResolvedValueOnce(REPO)
    .mockResolvedValueOnce(REPO)
    .mockResolvedValueOnce(NOT_REPO);
  harness.state.spawned.length = 0;
  render();
  const first = harness.state.spawned.shift();
  assert.ok(first);
  render();
  assert.equal(harness.state.spawned.length, 0);
  await drain(first!);
  now += PROBE_TTL;
  render();
  assert.equal(harness.state.spawned.length, 0);
  now += 1;
  render();
  const sameAnswer = harness.state.spawned.shift();
  assert.ok(sameAnswer);
  await drain(sameAnswer!);
  assert.equal(harness.state.notifications, 1);
  now += PROBE_TTL + 1;
  render();
  const changedAnswer = harness.state.spawned.shift();
  assert.ok(changedAnswer);
  await drain(changedAnswer!);
  assert.equal(harness.state.notifications, 2);
  assert.equal(harness.state.exec.mock.calls.length, 3);
});

test("a known folder answer stays visible while its expired probe refreshes", async () => {
  arrange({ spaces: [folderOf("s1", "/refresh")], focus: { pane: "p1", cwd: "/refresh" } });
  harness.state.exec.mockResolvedValueOnce(NOT_REPO);
  harness.state.spawned.length = 0;
  render();
  const initialProbe = harness.state.spawned.shift();
  assert.ok(initialProbe);
  await drain(initialProbe!);
  assert.ok(buttonIds(record(render())).includes("workspaces"));

  now += PROBE_TTL + 1;
  let resolveRefresh: ((value: typeof REPO) => void) | undefined;
  harness.state.exec.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveRefresh = resolve;
      }),
  );
  harness.state.spawned.length = 0;
  render();
  const refresh = harness.state.spawned.shift();
  assert.ok(refresh);
  const pendingRefresh = drain(refresh!);
  assert.ok(buttonIds(record(render())).includes("workspaces"));
  resolveRefresh?.(NOT_REPO);
  await pendingRefresh;
});

test("a changed target restarts a pending probe and drops the stale answer", async () => {
  arrange({ spaces: [folderOf("s1", "/stale-a")], focus: { pane: "p1", cwd: "/stale-a" } });
  let resolveA: ((value: typeof REPO) => void) | undefined;
  let resolveB: ((value: typeof REPO) => void) | undefined;
  harness.state.exec
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveA = resolve;
        }),
    )
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveB = resolve;
        }),
    );
  harness.state.spawned.length = 0;
  render();
  const first = harness.state.spawned.shift();
  arrange({ spaces: [folderOf("s1", "/stale-b")], focus: { pane: "p1", cwd: "/stale-b" } });
  render();
  const second = harness.state.spawned.shift();
  assert.ok(first && second);
  const pendingA = drain(first!);
  resolveA?.(REPO);
  await pendingA;
  assert.equal(harness.state.notifications, 0);
  const pendingB = drain(second!);
  resolveB?.(REPO);
  await pendingB;
  assert.equal(harness.state.notifications, 1);
  assert.equal(harness.state.exec.mock.calls.length, 2);
});

test("no folder is a resolved non-repo and null pane/space lists are safe", () => {
  arrange({ spaces: null, panes: null, focus: null });
  harness.state.exec.mockClear();
  harness.state.spawned.length = 0;
  const tree = record(render());
  assert.equal(harness.state.exec.mock.calls.length, 0);
  assert.deepEqual(buttonIds(tree), ["files", "agent-sessions", "workspaces", "pr-checks"]);
  arrange({
    spaces: [folderOf("s1", "/focus")],
    panes: null,
    focus: { pane: "p1", cwd: "/focus" },
  });
  harness.state.spawned.length = 0;
  render();
  assert.equal(harness.state.spawned.length, 1);
});

test("a missing panel stack uses the default active tab without fallback", () => {
  arrange({ layoutPresent: false });
  harness.state.spawned.length = 0;
  render();
  assert.equal(harness.state.spawned.length, 0);
});

test("gated active tabs fall back asynchronously, and visible tabs do not", async () => {
  arrange({
    spaces: [folderOf("s1", "/fallback")],
    focus: { pane: "p1", cwd: "/fallback" },
    active: "changes",
  });
  harness.state.exec.mockResolvedValue(NOT_REPO);
  harness.state.spawned.length = 0;
  render();
  const probe = harness.state.spawned.shift();
  assert.ok(probe);
  await drain(probe!);
  harness.state.spawned.length = 0;
  harness.state.calls.length = 0;
  render();
  assert.equal(
    harness.state.calls.some(([name]) => name === "layout.select"),
    false,
  );
  const fallback = harness.state.spawned.find((job) => job.length === 0);
  assert.ok(fallback);
  fallback!({
    notify: () => {
      harness.state.notifications += 1;
    },
  });
  assert.deepEqual(
    harness.state.calls.filter(([name]) => name === "layout.select").map(([, args]) => args),
    [[{ stack: "panel-body", child: "files" }]],
  );

  arrange({
    spaces: [folderOf("s1", "/visible")],
    focus: { pane: "p1", cwd: "/visible" },
    active: "workspaces",
  });
  harness.state.exec.mockResolvedValue(NOT_REPO);
  harness.state.spawned.length = 0;
  render();
  const visibleProbe = harness.state.spawned.shift();
  if (visibleProbe) await drain(visibleProbe);
  harness.state.spawned.length = 0;
  render();
  assert.equal(
    harness.state.spawned.some((job) => job.length === 0),
    false,
  );
});

test("view commands run in order, unknown commands repaint, and empty commands are ignored", async () => {
  harness.state.commandQueue.push("search", "agent-sessions", null, "ports");
  harness.state.spawned.length = 0;
  new PanelHead().init({}, context());
  const loop = harness.state.spawned.shift();
  assert.ok(loop);
  const running = drain(loop!);
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(
    harness.state.calls.filter(
      ([name]) =>
        name === "layout.show" || name === "layout.select" || name === "orca-files.search",
    ),
    [
      ["layout.show", [{ id: "panel" }]],
      ["layout.select", [{ stack: "panel-body", child: "files" }]],
      ["orca-files.search", [undefined]],
      ["layout.show", [{ id: "panel" }]],
      ["layout.select", [{ stack: "panel-body", child: "ports" }]],
    ],
  );
  assert.equal(harness.state.notifications, 3);
  void running;
});

test("panel controls expose their IDs, labels, roles, selected state, and click handlers", () => {
  arrange({
    spaces: [folderOf("s1", "/controls")],
    focus: { pane: "p1", cwd: "/controls" },
    active: "changes",
  });
  harness.state.exec.mockResolvedValue(REPO);
  harness.state.spawned.length = 0;
  render();
  const probe = harness.state.spawned.shift();
  assert.ok(probe);
  return drain(probe!).then(() => {
    const root = record(render()) as RecordedNode;
    const controls = buttons(root);
    assert.deepEqual(
      controls.map(({ a }) => a[0]),
      ["panel-files", "panel-agent-sessions", "panel-changes", "panel-checks"],
    );
    for (const control of controls) {
      const calls = control.c;
      assert.ok(calls.some(([name, args]) => name === "role" && args[0] === "button"));
      assert.ok(calls.some(([name]) => name === "accessibility_label"));
      assert.ok(calls.some(([name, args]) => name === "on_click" && args[0] === "fn"));
    }
    assert.ok(
      controls.some(
        ({ a, c }) =>
          a[0] === "panel-changes" &&
          c.some(([name, args]) => name === "selected" && args[0] === true),
      ),
    );
  });
});

test("every bridged Orca header key names a registered view reveal", () => {
  const keys = JSON.parse(readFileSync(new URL("../../../keys.json", import.meta.url), "utf8")) as {
    "layout:orca": Record<string, unknown>;
  };
  const bridged = Object.values(keys["layout:orca"])
    .filter((action) => String(action).startsWith("orca-right-sidebar-header."))
    .map((action) => String(action).slice("orca-right-sidebar-header.".length));
  assert.ok(bridged.length >= 4);
  for (const view of bridged) assert.ok(Object.hasOwn(VIEW_REVEALS, view), `${view} has no reveal`);
});
