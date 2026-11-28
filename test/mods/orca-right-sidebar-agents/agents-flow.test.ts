import assert from "node:assert/strict";
import { test, vi } from "vite-plus/test";
import { InputState } from "gpui-base";
import type { Context } from "gpui-kit";
import type { SpaceInfo } from "herdr";
import { setAgentConfigRuntime } from "../../support/agent-config-runtime.js";
import Agents, { resolveProjectScope } from "../../../src/mods/orca-right-sidebar-agents/main.js";

type Exec = (_cmd: string, args: string[]) => { stdout: string };
const host = vi.hoisted((): { exec: Exec | null; agents: () => unknown[] } => ({
  exec: null,
  agents: () => [],
}));
vi.mock("herdr", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    exec: (command: string, args: string[]) => host.exec?.(command, args) ?? { stdout: "" },
    agents: () => host.agents(),
  };
});

type SessionFixture = Agents["history"][number];
type AgentsTheme = Parameters<Agents["historyRow"]>[1];

function session(fields: Partial<SessionFixture> & Pick<SessionFixture, "path">): SessionFixture {
  return {
    id: "id",
    cwd: null,
    title: "title",
    model: null,
    updatedAt: null,
    preview: null,
    ...fields,
  };
}

function spaceInfo(fields: Pick<SpaceInfo, "id" | "folder"> & Partial<SpaceInfo>): SpaceInfo {
  return {
    index: 0,
    name: fields.id,
    named: false,
    machine: null,
    branch: null,
    active: false,
    status: null,
    tabs: [],
    ...fields,
  };
}

function nodeText(value: object): string {
  setAgentConfigRuntime({ key: "agents", argv: [] });
  const node: unknown = Reflect.get(value, "__node");
  return JSON.stringify(node);
}

function renderText(view: Agents): string {
  setAgentConfigRuntime({ key: "agents", argv: [] });
  return nodeText(view.render());
}

function initView(view: Agents, cx: object): void {
  view.init({}, cx as Context);
}

test("scan keeps the user title, earliest cwd and latest assistant preview", async () => {
  const view = new Agents(),
    jobs: Array<(cx: unknown) => Promise<void>> = [],
    timers: Array<[number, (cx: unknown) => void]> = [];
  const path = "/sessions/one.jsonl";
  const records = [
    { type: "session", id: "abc", cwd: "/repo", title: "Initial", timestamp: "2020-01-01" },
    { type: "session_info", name: "Named", timestamp: "2020-01-02" },
    { type: "title", v: 1, source: "auto", title: "Generated", updatedAt: "2021-01-01" },
    { type: "model_change", modelId: "m" },
    { type: "message", message: { role: "user", content: "hello" } },
    {
      type: "message",
      timestamp: "2020-01-03",
      message: { role: "assistant", content: ["one", {}, { text: "two" }], model: "final" },
    },
  ];
  const exec: Exec = (_cmd, args) => ({
    stdout:
      args.at(-1) === path
        ? ["{invalid", ...records.map((r) => JSON.stringify(r))].join("\n")
        : path,
  });
  host.exec = exec;
  let notified = 0;
  const cx = {
    spawn: (fn: (cx: unknown) => Promise<void>) => jobs.push(fn),
    notify: () => notified++,
    timer: { every: (ms: number, fn: (cx: unknown) => void) => timers.push([ms, fn]) },
  };
  initView(view, cx);
  const job = jobs.shift();
  assert.ok(job);
  await job(cx);
  assert.deepEqual(view.history, [
    {
      id: "abc",
      path,
      cwd: "/repo",
      title: "Named",
      model: "final",
      updatedAt: Date.parse("2020-01-03"),
      preview: { role: "assistant", text: "one  two" },
    },
  ]);
  assert.deepEqual(
    timers.map(([ms]) => ms),
    [1000, 60000],
  );
  timers[0][1](cx);
  timers[1][1](cx);
  assert.equal(jobs.length, 1);
  assert.equal(notified, 1);
  const space = spaceInfo({ active: true, id: "main", folder: "/repo" });
  Object.assign(globalThis, { __herdrSpaces: () => [space] });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: () =>
        JSON.stringify({
          entry: { repo: "/common", top: "/repo", worktrees: [{ path: "/linked" }] },
        }),
    },
  });
  view.scope = "project";
  view.search = InputState.new({ value: "named" });
  assert.ok(renderText(view).includes("Resume Named"));
  view.search = InputState.new({ value: "other" });
  view.historyLoading = false;

  assert.ok(renderText(view).includes("No sessions match the current filters"));
});

async function scan(path: string, records: unknown[]) {
  const view = new Agents();
  const jobs: Array<(cx: unknown) => Promise<void>> = [];
  host.exec = (_cmd, args) => ({
    stdout: args.length === 2 ? path : records.map((r) => JSON.stringify(r)).join("\n"),
  });
  initView(view, {
    spawn: (fn: (cx: unknown) => Promise<void>) => {
      jobs.push(fn);
    },
    notify() {},
    timer: { every() {} },
  });
  const job = jobs.shift();
  assert.ok(job);
  await job({ notify() {} });
  return view.history[0];
}
const SESSION = "/s/0123abcd-0123-0123-0123-0123456789ab.jsonl";

test("a user-given name outranks any automatic title, whichever comes first", async () => {
  const auto = { type: "title", v: 1, source: "auto", title: "Auto", updatedAt: "2021-01-01" };
  const user = { type: "session_info", name: " Mine ", timestamp: "2020-01-01" };
  assert.equal((await scan(SESSION, [auto, user])).title, "Mine");
  assert.equal((await scan(SESSION, [user, auto])).title, "Mine");
  assert.equal(
    (await scan(SESSION, [{ type: "title", v: 1, source: "user", title: "Set" }, user])).title,
    "Mine",
  );
});

test("among automatic titles the newer stamp wins and unknown sources, versions and blanks are ignored", async () => {
  const auto = (title: string, updatedAt: string, extra: Record<string, unknown> = {}) => ({
    type: "title",
    v: 1,
    source: "auto",
    title,
    updatedAt,
    ...extra,
  });
  assert.equal(
    (await scan(SESSION, [auto("New", "2021-01-01"), auto("Old", "2020-01-01")])).title,
    "New",
  );
  assert.equal(
    (await scan(SESSION, [auto("Old", "2020-01-01"), auto("New", "2021-01-01")])).title,
    "New",
  );
  assert.equal(
    (await scan(SESSION, [auto("Later", "bad"), auto("Kept", "2020-01-01")])).title,
    "Kept",
  );
  assert.equal(
    (
      await scan(SESSION, [
        auto("Wrong", "2020", { v: 2 }),
        auto("Blank", "2020", { title: "  " }),
        auto("Odd", "2020", { source: "bogus" }),
        { type: "title_change", title: "Changed", titleSource: "auto", timestamp: "2019-01-01" },
      ])
    ).title,
    "Changed",
  );
  assert.equal(
    (await scan(SESSION, [{ type: "session", id: "x", title: "From session", cwd: " /w " }])).cwd,
    "/w",
  );
});

test("without a name the first user message, then the short id, titles the session", async () => {
  const message = (role: string, content: unknown) => ({
    type: "message",
    message: { role, content },
  });
  assert.equal(
    (
      await scan(SESSION, [
        message("assistant", "hi"),
        message("user", " first "),
        message("user", "second"),
      ])
    ).title,
    "first",
  );
  const bare = await scan(SESSION, [{ type: "x" }]);
  assert.equal(bare.title, "OMP 0123abcd");
  assert.equal(bare.id, "0123abcd-0123-0123-0123-0123456789ab");
  assert.equal(bare.updatedAt, null);
  assert.equal(bare.preview, null);
  const modelled = await scan("/s/plain.jsonl", [
    { type: "model_change", model: "a" },
    { type: "model_change", modelId: "b" },
    { type: "message", message: { role: "user", content: [] } },
  ]);
  assert.deepEqual([modelled.id, modelled.model, modelled.title], ["plain", "b", "OMP plain"]);
});

test("project scope lists agents and sessions from the repo other checkouts, not from other repos", () => {
  const view = new Agents();
  const spaces = [
    spaceInfo({ id: "s1", folder: "/repo", active: true }),
    spaceInfo({ id: "s2", folder: "/linked" }),
    spaceInfo({ id: "s3", folder: "/other" }),
  ];
  Object.assign(globalThis, { __herdrSpaces: () => spaces });
  host.agents = () =>
    ["s1", "s2", "s3"].map((space) => ({
      address: `t-${space}`,
      status: "idle",
      title: `agent ${space}`,
      space,
    }));
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: () =>
        JSON.stringify({
          a: { repo: "/common", top: "/repo", worktrees: [{ path: "/linked" }] },
          b: { repo: "/zzz", top: "/other" },
        }),
    },
  });
  view.scope = "project";
  view.history = ["/repo/x", "/linked/y", "/other/z", null].map((cwd, i) =>
    session({ path: `/p/${i}`, cwd, title: `session ${i}` }),
  );
  view.search = InputState.new({ value: "" });
  const scope = resolveProjectScope(spaces[0], spaces);
  assert.deepEqual([...scope.projectPaths], ["/repo", "/linked"]);
  assert.deepEqual(
    spaces.map((s) => scope.isSameProject(s)),
    [true, true, false],
  );
  assert.equal(scope.isSameProject(undefined), false);
  view.scope = "workspace";
  assert.equal(scope.isSameProject(spaces[2]), false);
});

test("live agents render with their state, program icon and location", () => {
  setAgentConfigRuntime({ key: "agents", argv: [] });
  Object.assign(globalThis, {
    __herdrSpaces: () => [spaceInfo({ id: "s1", folder: "/repo", active: true })],
  });
  host.agents = () => [
    {
      address: "t1",
      status: "working",
      title: "Build",
      app: null,
      program: { key: "omp", name: "omp", icon: "i.svg", tint: true },
      space: "s1",
      space_name: "main",
      tab_name: "build",
      tab_index: 1,
    },
    {
      address: "t2",
      status: "blocked",
      title: "",
      app: "omp",
      program: { key: "p", name: "p", icon: "i.png", tint: false },
      space: "s1",
      space_name: "",
      tab_name: null,
      tab_index: 2,
    },
    {
      address: "t3",
      status: "done",
      title: "Done",
      app: null,
      program: { key: "q", name: "q", icon: null, tint: false },
      space: "s1",
      space_name: "main",
      tab_name: "",
      tab_index: 3,
    },
    {
      address: "t4",
      status: "idle",
      title: "Idle",
      app: null,
      program: undefined,
      space: "s1",
      space_name: "main",
      tab_name: "idle",
      tab_index: 4,
    },
  ];
  const view = new Agents();
  view.search = InputState.new({ value: "" });
  const text = renderText(view);
  for (const expected of [
    "agent-t1",
    "Build — working",
    "agent-t2",
    "Done — done",
    "agent-t4",
    "tab 3",
  ]) {
    assert.ok(text.includes(expected), expected);
  }
  assert.ok(!text.includes("No live agents"));
});

test("theme tokens reach the panel exactly as the host supplies them, malformed ones included", () => {
  setAgentConfigRuntime({ key: "agents", argv: [] });
  Object.assign(globalThis, {
    __herdrTheme: () => ({ foreground: "#112233cc", muted: "red" }),
  });
  host.agents = () => [
    {
      address: "t1",
      status: "idle",
      title: "Idle",
      app: null,
      program: { key: "x", name: "x", icon: null, tint: false },
      space: "s1",
      space_name: "main",
      tab_name: "t",
      tab_index: 1,
    },
  ];
  try {
    const view = new Agents();
    view.search = InputState.new({ value: "" });
    view.history = [
      session({ path: "/p/1", title: "t", cwd: "/repo", preview: { role: "user", text: "q" } }),
    ];
    const text = renderText(view);
    for (const expected of ['"red"', "#112233a3", "#00000000", "undefined66"]) {
      assert.ok(text.includes(expected), expected);
    }
  } finally {
    Object.assign(globalThis, { __herdrTheme: undefined });
  }
});

test("a git cache that is not an object, or not JSON, leaves only the active folder in scope", () => {
  const spaces = [spaceInfo({ id: "s1", folder: "/repo", active: true })];
  for (const stored of ["{bad", "null", "5"]) {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: { getItem: () => stored },
    });
    assert.deepEqual([...resolveProjectScope(spaces[0], spaces).projectPaths], ["/repo"]);
  }
});

test("a message whose parts are not text contributes nothing, and text parts are joined", async () => {
  const message = await scan(SESSION, [
    {
      type: "message",
      message: { role: "assistant", content: ["a", 5, null, { text: 3 }, { text: "b" }] },
    },
  ]);
  assert.deepEqual(message.preview, { role: "assistant", text: "a    b" });
});

test("session rows read their age and the scope and search controls report their state", () => {
  setAgentConfigRuntime({ key: "agents", argv: [] });
  const view = new Agents(),
    at = (ms: number) => Date.now() - ms;
  Object.assign(globalThis, { __herdrSpaces: () => [] });
  host.agents = () => [];
  view.search = InputState.new({ value: "" });
  view.history = [
    30_000,
    5 * 60_000,
    2 * 3_600_000,
    3 * 86_400_000,
    60 * 86_400_000,
    800 * 86_400_000,
  ].map((age, i) =>
    session({
      path: `/p/${i}`,
      title: `t${i}`,
      cwd: "/w",
      model: "m",
      updatedAt: at(age),
      preview: { role: "user", text: "q" },
    }),
  );
  view.history.push(session({ path: "/p/x", title: "unknown", updatedAt: NaN }));
  const theme: AgentsTheme = {
    foreground: "#f",
    muted: "#m",
    dim: "#d",
    border: "#b",
    hover: "#h",
    working: "#w",
    blocked: "#x",
    done: "#c",
    idle: "#i",
    raised: "#r",
    background: "#g",
    input: "#n",
  };
  const page = view.history.map((entry) => nodeText(view.historyRow(entry, theme))).join("");
  for (const text of [
    "Just now",
    "5m ago",
    "2h ago",
    "3d ago",
    "2mo ago",
    "2y ago",
    "Unknown time",
    "You",
    "No conversation preview available",
    "unknown folder",
  ])
    assert.ok(page.includes(text), text);
  view.history = [];
  assert.ok(nodeText(view.sessionList(theme, [], [])).includes("No agent sessions found"));
  view.historyError = "boom";
  view.historyLoading = true;
  const loading = nodeText(view.sessionList(theme, [], []));
  assert.ok(loading.includes("boom"));
  assert.ok(loading.includes("Scanning sessions"));
  const runs: unknown[] = [];
  Object.assign(globalThis, {
    __herdrRun: (cmd: string, args: unknown) => {
      runs.push([cmd, args]);
    },
  });
  view.resume(session({ path: "/p/1", cwd: null }));
  view.resume(session({ path: "/p/2", cwd: "/w" }));
  assert.deepEqual(runs, [
    ["terminal.open", { argv: ["omp", "--resume=/p/1"] }],
    ["terminal.open", { argv: ["omp", "--resume=/p/2"], folder: "/w" }],
  ]);
});
