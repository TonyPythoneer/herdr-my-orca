import { afterEach, it } from "vite-plus/test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import vm from "node:vm";
import {
  planRenderRows,
  agentsByRow,
  foldKey,
} from "../../mods/orca-sidebar-projects/worktree-plan.js";

const { stored, workspaceOptions } = await import("../../mods/orca-sidebar-projects/storage.js");

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function scratch(): string {
  const root = mkdtempSync(join(tmpdir(), "orca-virtual-test-"));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

it("performance fixture does not drive focus or add unconditional polling notifications", () => {
  const root = scratch();
  const destination = join(root, "candidate");
  execFileSync("python3", [
    fileURLToPath(new URL("../../scripts/perf-spaces-virtual.py", import.meta.url)),
    destination,
  ]);
  const source = readFileSync(join(destination, "main.js"), "utf8");
  assert.doesNotMatch(source, /fixture-198|dispatch_action\(smoke/);
  assert.match(source, /this\.virtualFocusTick\(cx\)/);
  assert.match(
    source,
    /this\.projectVirtualRows\(cx\); this\.prepareVirtualRows\(\); if \(this\.syncRetained\(cx\)\) cx\.notify\(\)/,
  );
});

it("both fixtures use fixed spaces, agents, panes and machines", () => {
  const root = scratch();
  for (const script of ["perf-spaces.py", "perf-spaces-virtual.py"]) {
    const destination = join(root, script);
    execFileSync("python3", [
      fileURLToPath(new URL(`../../scripts/${script}`, import.meta.url)),
      destination,
    ]);
    const source = readFileSync(join(destination, "main.js"), "utf8");
    assert.match(
      source,
      /spaces as hostSpaces, machines as hostMachines, panes as hostPanes, agents as hostAgents/,
    );
    for (const name of ["spaces", "agents", "panes", "machines"]) {
      assert.match(source, new RegExp(`const ${name} = \\(\\) => `));
    }
  }
});

function candidate(extras: Record<string, unknown> = {}) {
  const root = scratch();
  const destination = join(root, "candidate");
  execFileSync("python3", [
    fileURLToPath(new URL("../../scripts/perf-spaces-virtual.py", import.meta.url)),
    destination,
  ]);
  const source = readFileSync(join(destination, "main.js"), "utf8")
    .replace(/^import .*;$/gm, "")
    .replace("export default class Spaces", "class Spaces");
  const scope = {
    View: class {},
    onStop: () => null,
    shared: () => null,
    planRenderRows,
    agentSettingsOpen: () => false,
    stored,
    workspaceOptions,
    ...extras,
  };
  vm.runInNewContext(source + "\nglobalThis.Spaces = Spaces;", scope);
  return new (scope as { Spaces: new () => Record<string, unknown> }).Spaces();
}

it("signature queue prioritizes focus, bounds batches, uses latest data and drops removed rows", () => {
  const owner = candidate();
  Object.assign(owner, {
    virtualQueue: new Map(),
    virtualCurrent: new Map(),
    retainedPending: new Map(),
    virtualFocusPending: { key: "79" },
  });
  let calls = 0;
  owner.rowSignature = (data: { name: string }) => {
    calls++;
    return data.name;
  };
  for (let i = 0; i < 80; i++) {
    const data = { name: String(i) };
    (owner.virtualQueue as Map<string, unknown>).set(String(i), data);
    (owner.virtualCurrent as Map<string, unknown>).set(String(i), data);
  }
  (owner.virtualQueue as Map<string, unknown>).set("20", { name: "latest" });
  (owner.virtualCurrent as Map<string, unknown>).delete("30");
  (owner.retainedPending as Map<string, unknown>).set("removed", { name: "stale" });
  (owner.prepareVirtualRows as () => void)();
  assert.equal(calls, 16);
  assert.equal(
    (owner.retainedPending as Map<string, { signature: string }>).get("79")?.signature,
    "79",
  );
  assert.equal((owner.retainedPending as Map<string, unknown>).has("removed"), false);
  while ((owner.virtualQueue as Map<string, unknown>).size) {
    const before = calls;
    (owner.prepareVirtualRows as () => void)();
    assert.ok(calls - before <= 16);
  }
  assert.equal(
    (owner.retainedPending as Map<string, { signature: string }>).get("20")?.signature,
    "latest",
  );
  assert.equal((owner.retainedPending as Map<string, unknown>).has("30"), false);
  assert.equal((owner.retainedPending as Map<string, unknown>).size, 79);
});

it("event preparation prioritizes visible rows within the 16-signature cap and background stays FIFO", () => {
  const owner = candidate();
  const calls: string[] = [];
  Object.assign(owner, {
    virtualQueue: new Map(),
    virtualCurrent: new Map(),
    retainedPending: new Map(),
    virtualVisible: Array.from({ length: 20 }, (_, i) => String(i + 20)),
    virtualFocusPending: { key: "5", direction: 1 },
    fs: { keyboard: false },
    rowSignature: (data: { name: string }) => {
      calls.push(data.name);
      return data.name;
    },
  });
  for (let i = 0; i < 40; i++) {
    const key = String(i),
      data = { name: key };
    (owner.virtualQueue as Map<string, unknown>).set(key, data);
    (owner.virtualCurrent as Map<string, unknown>).set(key, data);
  }
  (owner.prepareVirtualRows as (priority: boolean) => void)(true);
  assert.equal(calls.length, 16);
  assert.deepEqual(calls, ["5", ...Array.from({ length: 15 }, (_, i) => String(i + 20))]);
  assert.equal((owner.virtualQueue as Map<string, unknown>).size, 24);

  const before = calls.length;
  (owner.prepareVirtualRows as (priority: boolean) => void)(false);
  assert.equal(calls.length - before, 16);
  assert.deepEqual(calls.slice(before), [
    ...Array.from({ length: 5 }, (_, i) => String(i + 35)),
    ...Array.from({ length: 5 }, (_, i) => String(i)),
    ...Array.from({ length: 6 }, (_, i) => String(i + 6)),
  ]);
  assert.equal((owner.virtualQueue as Map<string, unknown>).size, 8);
});

it("background batches rotate through a large visible set while old FIFO work progresses", () => {
  const owner = candidate();
  const visible = Array.from({ length: 24 }, (_, i) => `visible-${i}`);
  const calls: string[] = [];
  Object.assign(owner, {
    virtualQueue: new Map(),
    virtualCurrent: new Map(),
    retainedPending: new Map(),
    virtualVisible: visible,
    virtualVisibleCursor: 0,
    virtualFocusPending: null,
    fs: { keyboard: false },
    rowSignature: (data: { name: string }) => {
      calls.push(data.name);
      return data.name;
    },
  });
  (owner.virtualCurrent as Map<string, unknown>).set("old-nonvisible", { name: "old-nonvisible" });
  (owner.virtualQueue as Map<string, unknown>).set(
    "old-nonvisible",
    (owner.virtualCurrent as Map<string, unknown>).get("old-nonvisible"),
  );
  for (const key of visible) {
    const data = { name: key };
    (owner.virtualCurrent as Map<string, unknown>).set(key, data);
    (owner.virtualQueue as Map<string, unknown>).set(key, data);
  }
  const progressed = new Set<string>();
  for (let batch = 0; batch < 4; batch++) {
    (owner.refreshRetained as () => void)();
    const before = calls.length;
    (owner.prepareVirtualRows as (priority: boolean) => void)(false);
    assert.ok(calls.length - before <= 16);
    for (const key of calls.slice(before)) progressed.add(key);
  }
  assert.ok(progressed.has("old-nonvisible"));
  for (const key of visible) assert.ok(progressed.has(key), `background projection reached ${key}`);
});

it("refresh invalidates only visible current rows", () => {
  const owner = candidate();
  const keys = ["row-2", "row-17"];
  const signed: string[] = [];
  Object.assign(owner, {
    virtualQueue: new Map(),
    virtualCurrent: new Map(),
    retainedPending: new Map(),
    virtualVisible: keys,
    fs: { keyboard: false },
    rowSignature: (data: { name: string }) => {
      signed.push(data.name);
      return data.name;
    },
  });
  for (let i = 0; i < 30; i++)
    (owner.virtualCurrent as Map<string, unknown>).set(`row-${i}`, { name: `row-${i}` });
  (owner.virtualQueue as Map<string, unknown>).set("row-2", { name: "stale" });
  (owner.refreshRetained as () => void)();
  assert.deepEqual(Array.from((owner.virtualQueue as Map<string, unknown>).keys()), keys);
  assert.equal(
    (owner.virtualQueue as Map<string, unknown>).get("row-2"),
    (owner.virtualCurrent as Map<string, unknown>).get("row-2"),
  );
  (owner.prepareVirtualRows as (priority: boolean) => void)(true);
  assert.deepEqual(Array.from((owner.retainedPending as Map<string, unknown>).keys()), keys);
  assert.deepEqual(signed, ["row-2", "row-17"]);
});

it("new virtual focus request enqueues and prepares its row before notifying", () => {
  const owner = candidate();
  const key = JSON.stringify(["workspace", "focus-target"]);
  const calls: string[] = [];
  let rootNotifies = 0;
  let scrolled: number | undefined;
  Object.assign(owner, {
    virtualCurrent: new Map([[key, { name: "fresh" }]]),
    virtualQueue: new Map(),
    retainedPending: new Map(),
    virtualVisible: [],
    virtualRows: [{ r: { virtualKey: key } }],
    virtualFocusPending: null,
    virtualScroll: {
      scroll_to_item(index: number) {
        scrolled = index;
      },
    },
    fs: { free: [], handles: new Map(), keyboard: false },
    rowSignature: (data: { name: string }) => {
      calls.push(data.name);
      return data.name;
    },
    ownerCx: {
      notify() {
        rootNotifies++;
      },
    },
    syncRetained: () => false,
  });
  (owner.virtualRequest as (key: string, direction: number, handle: unknown) => void)(key, 1, {
    focus_handle: () => ({}),
  });
  assert.equal(scrolled, 0);
  assert.deepEqual(calls, ["fresh"]);
  assert.equal(
    (owner.retainedPending as Map<string, { signature: string }>).get(key)?.signature,
    "fresh",
  );
  assert.equal((owner.virtualQueue as Map<string, unknown>).has(key), false);
  assert.equal((owner.virtualFocusPending as { key: string }).key, key);
  assert.equal((owner.virtualFocusPending as { direction: number }).direction, 1);
  assert.equal(rootNotifies, 1);
});

function nativeOps() {
  const ops: { type: string; key?: string }[] = [];
  return {
    ops,
    cx: {
      new(_type: string, props: { key?: string }) {
        ops.push({ type: "create", key: props.key });
        return {
          set_props(next: { key?: string }) {
            ops.push({ type: "update", key: next.key });
          },
          release() {
            ops.push({ type: "release", key: props.key });
          },
        };
      },
    },
  };
}

it("candidate adoption prioritizes focus and visible rows, shares 16 native ops with cleanup, and releases once", () => {
  const owner = candidate({ WorkspaceRow: class {} });
  const { ops, cx } = nativeOps();
  const visible = Array.from({ length: 5 }, (_, i) => "visible-" + i);
  Object.assign(owner, {
    retainedRows: new Map(),
    retainedPending: new Map(),
    virtualVisible: visible,
    virtualFocusPending: { key: "focus-row" },
    virtualAdoptCursor: 0,
  });
  for (let i = 0; i < 100; i++) {
    const key = "retired-" + i;
    (owner.retainedRows as Map<string, unknown>).set(key, {
      signature: "old",
      entity: {
        release() {
          ops.push({ type: "release", key });
        },
      },
    });
  }
  for (let i = 0; i < 40; i++)
    (owner.retainedPending as Map<string, unknown>).set("pending-" + i, {
      signature: "pending-" + i,
    });
  (owner.retainedPending as Map<string, unknown>).set("focus-row", { signature: "focus-0" });
  for (let i = 0; i < visible.length; i++)
    (owner.retainedPending as Map<string, unknown>).set(visible[i], {
      signature: `visible-${i}-0`,
    });

  let start = ops.length;
  assert.equal((owner.syncRetained as (cx: unknown) => boolean)(cx), true);
  const first = ops.slice(start);
  assert.equal(first.length, 16);
  assert.deepEqual(
    first.slice(0, 8).map((op) => op.key),
    [
      "focus-row",
      "visible-0",
      "visible-1",
      "visible-2",
      "pending-0",
      "pending-1",
      "pending-2",
      "pending-3",
    ],
  );
  assert.deepEqual(
    first.slice(8).map((op) => op.type),
    Array(8).fill("release"),
  );

  let pass = 1;
  let previousRetired = Array.from((owner.retainedRows as Map<string, unknown>).keys()).filter(
    (key) => key.startsWith("retired-"),
  ).length;
  while (previousRetired) {
    for (let i = 0; i < visible.length; i++)
      (owner.retainedPending as Map<string, { signature: string }>).get(visible[i])!.signature =
        `visible-${i}-${pass}`;
    start = ops.length;
    (owner.syncRetained as (cx: unknown) => boolean)(cx);
    const batch = ops.slice(start);
    assert.ok(batch.length <= 16);
    if (pass === 1)
      assert.deepEqual(
        batch.slice(0, 4).map((op) => [op.type, op.key]),
        [
          ["create", "visible-3"],
          ["create", "visible-4"],
          ["update", "visible-0"],
          ["update", "visible-1"],
        ],
      );
    const retired = Array.from((owner.retainedRows as Map<string, unknown>).keys()).filter((key) =>
      key.startsWith("retired-"),
    ).length;
    assert.ok(
      retired < previousRetired,
      "stale cleanup progresses while visible rows keep changing",
    );
    previousRetired = retired;
    const released = ops.filter((op) => op.type === "release").map((op) => op.key);
    assert.equal(new Set(released).size, released.length, "no entity is released twice");
    pass++;
  }
  assert.equal(ops.filter((op) => op.type === "release").length, 100);
  assert.equal(new Set(ops.filter((op) => op.type === "release").map((op) => op.key)).size, 100);
  assert.ok(
    ops.filter((op) => op.type === "create").every((op) => !op.key?.startsWith("retired-")),
  );
  assert.equal((owner.retainedRows as Map<string, unknown>).has("retired-0"), false);
  start = ops.length;
  assert.equal((owner.syncRetained as (cx: unknown) => boolean)(cx), false);
  assert.equal(ops.length, start, "a settled snapshot does not resurrect retired rows");
});

it("candidate adoption keeps nonvisible FIFO rows progressing when nothing is retired", () => {
  const owner = candidate({ WorkspaceRow: class {} });
  const { ops, cx } = nativeOps();
  Object.assign(owner, {
    retainedRows: new Map(),
    retainedPending: new Map(),
    virtualVisible: ["visible"],
    virtualFocusPending: null,
    virtualAdoptCursor: 0,
  });
  for (let i = 0; i < 30; i++)
    (owner.retainedPending as Map<string, unknown>).set("queued-" + i, {
      signature: "queued-" + i,
    });
  (owner.retainedPending as Map<string, unknown>).set("visible", { signature: "visible" });
  assert.equal((owner.syncRetained as (cx: unknown) => boolean)(cx), true);
  assert.equal(ops.length, 16);
  assert.deepEqual(
    ops.slice(0, 3).map((op) => op.key),
    ["visible", "queued-0", "queued-1"],
  );
  assert.deepEqual(
    ops
      .filter((op) => op.type === "create")
      .map((op) => op.key)
      .slice(1),
    Array.from({ length: 15 }, (_, i) => "queued-" + i),
  );
  assert.equal((owner.retainedRows as Map<string, unknown>).size, 16);

  const start = ops.length;
  assert.equal((owner.syncRetained as (cx: unknown) => boolean)(cx), true);
  assert.ok(ops.length - start <= 16);
  assert.deepEqual(
    ops.slice(start).map((op) => op.key),
    Array.from({ length: 15 }, (_, i) => "queued-" + (i + 15)),
  );
  assert.equal((owner.retainedRows as Map<string, unknown>).size, 31);
});

it("focus waits for an unprepared existing row and cancels only when it is removed", () => {
  const owner = candidate();
  const request = { key: "pending", direction: 1 };
  Object.assign(owner, {
    virtualCurrent: new Map([["pending", {}]]),
    retainedPending: new Map(),
    virtualFocusPending: request,
  });
  (owner.virtualFocusTick as (cx: unknown) => void)({});
  assert.equal(owner.virtualFocusPending, request);
  (owner.virtualCurrent as Map<string, unknown>).delete("pending");
  (owner.virtualFocusTick as (cx: unknown) => void)({});
  assert.equal(owner.virtualFocusPending, null);
});

it("render consumes prepared rows and sizes without traversing the catalog", () => {
  let element: Record<string, unknown>;
  element = new Proxy(
    {},
    {
      get(_target, key) {
        if (key === "when")
          return (condition: boolean, apply: (el: unknown) => unknown) =>
            condition ? apply(element) : element;
        return () => element;
      },
    },
  );
  const metrics = { created: 0 };
  let suppliedSizes: unknown;
  const owner = candidate({
    metrics,
    console: { log() {} },
    theme: () => ({}),
    props: () => null,
    machines: () => [],
    layout: () => null,
    shared: () => undefined,
    setShared() {},
    focusRoot: (_owner: unknown, el: unknown) => el,
    Scrollbar: { vertical: () => element },
    native_div: () => element,
    native_v_flex: () => element,
    v_virtual_list: (_id: string, _count: number, sizes: unknown) => {
      suppliedSizes = sizes;
      return element;
    },
  });
  Object.assign(owner, {
    loaded: true,
    foldedRepos: new Set(),
    projectKeys: () => [],
    git: new Proxy(
      {},
      {
        ownKeys() {
          throw new Error("catalog traversed in render");
        },
      },
    ),
  });
  let factories: number | undefined;
  for (const count of [1, 10000]) {
    owner.virtualProjected = new Proxy(new Array(count), {
      get(target, key) {
        if (key === "map" || key === "filter" || key === Symbol.iterator)
          throw new Error("rows projected in render");
        return Reflect.get(target, key);
      },
    });
    owner.virtualItemSizes = new Array(count).fill(64);
    metrics.created = 0;
    (owner.render as (cx: unknown) => void)({});
    assert.equal(suppliedSizes, owner.virtualItemSizes);
    if (factories === undefined) factories = metrics.created;
    else assert.equal(metrics.created, factories);
  }
});

function projectedOwner(rows: unknown[], groupBy: string, extras: Record<string, unknown> = {}) {
  let currentGroupBy = groupBy;
  const owner = candidate({
    theme: () => ({}),
    panes: () => [],
    agents: () => [],
    foldKey,
    agentsByRow: (sourceRows: unknown[]) => agentsByRow(sourceRows, []),
    workspaceOptions: () => ({ ...workspaceOptions(), groupBy: currentGroupBy }),
    tint: (name: string) => name,
    avatarFile: () => null,
    setShared() {},
    ...extras,
  });
  Object.assign(owner, {
    ordered: () => rows,
    git: {},
    plan: { groups: [] },
    reconnecting: {},
    machines: [],
    folded: new Set(),
    foldedRepos: new Set(),
    expandedAgents: new Set(),
    unread: new Set(),
    virtualQueue: new Map(),
    retainedPending: new Map(),
    rowIndex: new Map(),
    virtualSizes: new Map(),
    rebuilt: () => false,
    reviewOf: () => null,
    fs: { keyboard: false },
    hoveredRepo: null,
    menuKey: null,
    hot: null,
    laneHot: null,
    pressed: null,
    over: null,
  });
  return {
    owner,
    groupBy(value: string) {
      currentGroupBy = value;
    },
  };
}

const worktree = (id: string, machine: string | null, status: string, repo = `repo-${id}`) => ({
  w: { id, name: id, machine, status, tabs: [] },
  g: { repo, branch: id },
  head: true,
});

it("task projection supports repo, status and none grouping with folds and measured sizes", () => {
  const rows = [
    worktree("fixture-a", null, "blocked", "repo-A"),
    worktree("fixture-b", null, "working", "repo-A"),
    worktree("fixture-c", null, "done", "repo-C"),
  ];
  rows[1].head = false;
  const { owner, groupBy } = projectedOwner(rows, "repo");
  (owner.plan as { groups: unknown[] }).groups = [
    { key: "repo-A", rows: rows.slice(0, 2) },
    { key: "repo-C", rows: rows.slice(2) },
  ];
  (owner.foldedRepos as Set<string>).add("repo-A");
  (owner.virtualSizes as Map<string, number>).set(JSON.stringify(["workspace", "fixture-a"]), 116);
  (owner.projectVirtualRows as (cx: unknown) => void)({});
  assert.deepEqual(
    Array.from(owner.virtualProjected as Array<{ w: { id: string } }>, (r) => r.w.id),
    ["fixture-a", "fixture-c"],
  );
  assert.deepEqual(
    Array.from(
      owner.virtualProjected as Array<{ w: { descriptor?: { kind?: string } } }>,
      (r) => r.w.descriptor?.kind ?? "row",
    ),
    ["row", "row"],
  );
  assert.deepEqual(Array.from(owner.virtualItemSizes as number[]), [116, 64]);
  assert.deepEqual(
    Array.from(owner.virtualRows as Array<{ r: { count: number } }>, (data) => data.r.count),
    [2, 1],
  );
  const previous = owner.virtualProjected as unknown[];
  (owner.foldedRepos as Set<string>).clear();
  (owner.projectVirtualRows as (cx: unknown) => void)({});
  assert.deepEqual(
    Array.from(owner.virtualProjected as Array<{ w: { id: string } }>, (r) => r.w.id),
    ["fixture-a", "fixture-b", "fixture-c"],
  );
  assert.deepEqual(
    Array.from(owner.virtualRows as Array<{ r: { count: number } }>, (data) => data.r.count),
    [2, 2, 1],
  );
  assert.equal(previous.length, 2);

  groupBy("workspace-status");
  (owner.projectVirtualRows as (cx: unknown) => void)({});
  assert.deepEqual(
    Array.from(
      owner.virtualProjected as Array<{ w: { descriptor?: { label?: string }; id: string } }>,
      (r) => r.w.descriptor?.label ?? r.w.id,
    ),
    ["Blocked", "fixture-a", "Working", "fixture-b", "Done", "fixture-c"],
  );
  assert.ok(
    (owner.virtualRows as Array<{ r: { w: { descriptor?: { kind?: string } } } }>)
      .filter((data) => data.r.w.descriptor?.kind === "status")
      .every((data) => (owner.virtualIds as (row: unknown) => unknown[])(data).length === 0),
  );

  groupBy("none");
  (owner.projectVirtualRows as (cx: unknown) => void)({});
  assert.deepEqual(
    Array.from(owner.virtualProjected as Array<{ w: { id: string } }>, (r) => r.w.id),
    ["fixture-a", "fixture-b", "fixture-c"],
  );
});

it("host projection keeps per-host descriptors unique and respects folding and repairs", () => {
  const rows = [
    worktree("fixture-local", null, "blocked"),
    worktree("fixture-remote-a", "remote-a", "blocked"),
    worktree("fixture-remote-b", "remote-b", "blocked"),
  ];
  const { owner } = projectedOwner(rows, "workspace-status");
  owner.machines = [
    { name: "remote-a", state: "connected" },
    { name: "remote-b", state: "connected" },
  ];
  owner.machineHead = (descriptor: unknown) => ({ kind: "machine-head", descriptor });
  owner.statusHead = (label: unknown, count: unknown) => ({ kind: "status-head", label, count });
  (owner.projectVirtualRows as (cx: unknown) => void)({});
  const hosts = (
    owner.virtualRows as Array<{
      r: { w: { descriptor?: { kind?: string; machine?: string | null } } };
    }>
  ).filter((data) => data.r.w.descriptor?.kind === "host");
  assert.deepEqual(
    Array.from(hosts, (data) => data.r.w.descriptor?.machine),
    [null, "remote-a", "remote-b"],
  );
  assert.equal(
    new Set(Array.from(owner.virtualProjected as Array<{ w: { id: string } }>, (r) => r.w.id)).size,
    (owner.virtualProjected as unknown[]).length,
  );
  assert.deepEqual(
    Array.from(
      hosts,
      (data) => (owner.rowElements as (row: unknown) => Array<{ kind: string }>)(data)[0].kind,
    ),
    ["machine-head", "machine-head", "machine-head"],
  );
  assert.deepEqual(
    Array.from(
      (owner.virtualRows as Array<{ r: { w: { descriptor?: { kind?: string } } } }>).filter(
        (data) => data.r.w.descriptor?.kind === "status",
      ),
      (data) => (owner.rowElements as (row: unknown) => Array<{ label: string }>)(data)[0].label,
    ),
    ["Blocked", "Blocked", "Blocked"],
  );

  (owner.folded as Set<string>).add("remote-b");
  (owner.projectVirtualRows as (cx: unknown) => void)({});
  assert.ok(
    (
      owner.virtualRows as Array<{
        r: { w: { descriptor?: { kind?: string; machine?: string | null } } };
      }>
    ).some(
      (data) => data.r.w.descriptor?.kind === "host" && data.r.w.descriptor.machine === "remote-b",
    ),
  );
  assert.ok(
    !(owner.virtualRows as Array<{ r: { w: { id: string } } }>).some(
      (data) => data.r.w.id === "fixture-remote-b",
    ),
  );

  (owner.folded as Set<string>).delete("remote-b");
  (owner.reconnecting as Record<string, unknown>)["remote-a"] = { error: "repair needed" };
  (owner.projectVirtualRows as (cx: unknown) => void)({});
  assert.ok(
    !(owner.virtualRows as Array<{ r: { w: { id: string } } }>).some(
      (data) => data.r.w.id === "fixture-remote-a",
    ),
  );
  const remoteHost = (
    owner.virtualRows as Array<{
      r: { w: { descriptor?: { kind?: string; machine?: string | null } } };
    }>
  ).find(
    (data) => data.r.w.descriptor?.kind === "host" && data.r.w.descriptor.machine === "remote-a",
  );
  assert.deepEqual(Array.from((owner.virtualIds as (row: unknown) => string[])(remoteHost)), [
    "machine-remote-a",
    "machine-connect-remote-a",
    "machine-add-remote-a",
  ]);
});

it("workspace virtual keys stay distinct from host heading ids and retained entries", () => {
  const collidingId = 'virtual-host-["remote","remote"]';
  const rows = [
    worktree("fixture-local", null, "blocked"),
    worktree(collidingId, "remote", "blocked"),
  ];
  const { owner } = projectedOwner(rows, "repo");
  owner.machines = [{ name: "remote", state: "connected" }];
  (owner.projectVirtualRows as (cx: unknown) => void)({});
  type Row = {
    r: {
      w: { id: string; descriptor?: { kind?: string; machine?: string | null } };
      virtualKey: string;
    };
  };
  const host = (owner.virtualRows as Row[]).find(
    (data) => data.r.w.descriptor?.kind === "host" && data.r.w.descriptor.machine === "remote",
  )!;
  const workspace = (owner.virtualRows as Row[]).find(
    (data) => data.r.w.id === collidingId && !data.r.w.descriptor,
  )!;
  assert.equal(host.r.w.id, workspace.r.w.id);
  assert.notEqual(host.r.virtualKey, workspace.r.virtualKey);
  assert.equal(
    new Set(Array.from(owner.virtualProjected as Row[], (r) => r.virtualKey)).size,
    (owner.virtualProjected as Row[]).length,
  );

  (owner.virtualSizes as Map<string, number>).set(host.r.virtualKey, 83);
  (owner.virtualSizes as Map<string, number>).set(workspace.r.virtualKey, 119);
  (owner.projectVirtualRows as (cx: unknown) => void)({});
  assert.deepEqual(Array.from(owner.virtualItemSizes as number[]), [64, 64, 83, 119]);
  (owner.prepareVirtualRows as () => void)();
  assert.equal((owner.retainedPending as Map<string, unknown>).has(host.r.virtualKey), true);
  assert.equal((owner.retainedPending as Map<string, unknown>).has(workspace.r.virtualKey), true);
});

it("keyboard movement skips status descriptors and host focus controls invalidate signatures", () => {
  const rows = [worktree("fixture-a", null, "blocked"), worktree("fixture-b", null, "working")];
  let focused = "space-fixture-a";
  const requests: unknown[][] = [];
  const { owner } = projectedOwner(rows, "workspace-status", { onStop: () => focused });
  owner.virtualRequest = (key: string, direction: number) => requests.push([key, direction]);
  (owner.projectVirtualRows as (cx: unknown) => void)({});
  (owner.virtualMove as (direction: number, cx: unknown) => void)(1, {});
  assert.deepEqual(requests.pop(), [JSON.stringify(["workspace", "fixture-b"]), 1]);
  focused = "space-fixture-b";
  (owner.virtualMove as (direction: number, cx: unknown) => void)(-1, {});
  assert.deepEqual(requests.pop(), [JSON.stringify(["workspace", "fixture-a"]), -1]);

  const hostRows = [
    worktree("fixture-local", null, "blocked"),
    worktree("fixture-remote", "remote", "blocked"),
  ];
  const { owner: hostOwner } = projectedOwner(hostRows, "repo");
  hostOwner.machines = [{ name: "remote", state: "connected" }];
  (hostOwner.reconnecting as Record<string, unknown>).remote = { error: "repair needed" };
  (hostOwner.projectVirtualRows as (cx: unknown) => void)({});
  type HostRow = { r: { w: { descriptor?: { kind?: string; machine?: string | null } } } };
  const host = (hostOwner.virtualRows as HostRow[]).find(
    (data) => data.r.w.descriptor?.kind === "host" && data.r.w.descriptor.machine === "remote",
  );
  const signature = (row: unknown, id: string | null, flag: boolean) =>
    (hostOwner.rowSignature as (row: unknown, id: string | null, flag: boolean) => unknown)(
      row,
      id,
      flag,
    );
  const base = signature(host, null, false);
  for (const id of ["machine-remote", "machine-connect-remote", "machine-add-remote"]) {
    assert.notEqual(signature(host, id, false), base, `focus on ${id} changes signature`);
  }
  assert.equal(signature(host, "space-unrelated", false), base);

  hostOwner.hot = "machine-add-remote";
  const hotSignature = signature(host, null, false);
  assert.notEqual(hotSignature, base);
  (hostOwner.folded as Set<string>).add("remote");
  assert.notEqual(signature(host, null, false), hotSignature);

  const workspace = {
    r: { ...rows[0], count: 0, pos: 0 },
    t: {},
    ps: [],
    mine: [],
    groupBy: "repo",
  };
  assert.equal(signature(workspace, "machine-remote", false), signature(workspace, null, false));
});
