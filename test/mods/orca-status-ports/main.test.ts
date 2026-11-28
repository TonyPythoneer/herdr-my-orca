import { afterEach, it, vi } from "vite-plus/test";
import assert from "node:assert/strict";
import type { AsyncContext, Context } from "gpui-kit";
import type { OverlaySpec } from "herdr";
import Ports from "../../../src/mods/orca-status-ports/main.js";
import type { Port } from "../../../src/shared/scan.ts";

type Call = [string, unknown[]];
type Node = { name: string; args: unknown[]; calls: Call[] };
type Host = typeof globalThis & {
  __herdrChecking?: () => boolean;
  __herdrExec?: (command: string, args?: string[]) => Promise<{ code: number; stdout?: string }>;
  __herdrShared?: (key: string) => unknown;
  __herdrSetShared?: (key: string, value: unknown) => void;
  __herdrProps?: () => unknown;
  __herdrSpaces?: () => unknown[];
  __herdrPanes?: () => Array<{ tab?: string | null; cwd?: string | null }>;
  __herdrOpenOverlay?: (spec: OverlaySpec) => string;
  __herdrCloseOverlay?: (id?: string) => void;
  __herdrNotify?: (message: unknown) => void;
  __herdrRun?: (...args: unknown[]) => void;
  __herdrWindow?: () => { platform: "linux" | "macos" | "windows" } | null;
  __herdrSettings?: () => Record<string, unknown> | null;
  __herdrTheme?: () => Record<string, string> | null | undefined;
  __herdrNextCommand?: () => Promise<string>;
};

const { elements, host } = vi.hoisted(() => {
  const host: Host = globalThis;
  const elements: { created: Node[]; copied: string[] } = { created: [], copied: [] };
  return { elements, host };
});

function isNode(value: unknown): value is Node {
  return typeof value === "object" && value !== null && "calls" in value;
}

function asNode(value: unknown): Node {
  if (isNode(value)) return value;
  throw new TypeError("expected a builder node");
}

function isCallback(value: unknown): value is (...args: unknown[]) => unknown {
  return typeof value === "function";
}

function builder(name: string, ...args: unknown[]): Node {
  const node: Node = { name, args, calls: [] };
  const proxy = new Proxy(node, {
    get(target, key: string | symbol) {
      if (typeof key === "symbol" || key === "toJSON") return undefined;
      if (key in target) return Reflect.get(target, key);
      return (...values: unknown[]) => {
        if (key === "when") {
          if (values[0] && isCallback(values[1])) values[1](proxy);
        } else if (key === "hover") {
          if (isCallback(values[0])) values[0](builder("hover"));
        } else {
          target.calls.push([key, values]);
        }
        return proxy;
      };
    },
  });
  elements.created.push(proxy);
  return proxy;
}

vi.mock("gpui-kit", () => ({
  View: class {},
  div: () => builder("div"),
  svg: (path: string) => builder("svg", path),
}));
vi.mock("gpui-base", () => ({ h_flex: () => builder("h_flex"), v_flex: () => builder("v_flex") }));
vi.mock("herdr", () => ({
  checking: () => host.__herdrChecking?.() ?? true,
  closeOverlay: (id?: string) => host.__herdrCloseOverlay?.(id) ?? null,
  exec: (command: string, args: string[] = []) =>
    host.__herdrExec?.(command, args) ?? Promise.resolve({ code: 0, stdout: "" }),
  nextCommand: () => host.__herdrNextCommand?.() ?? new Promise<string>(() => {}),
  notify: (message: unknown) => host.__herdrNotify?.(message) ?? "notification-test",
  openOverlay: (spec: OverlaySpec) => host.__herdrOpenOverlay?.(spec) ?? "overlay-test",
  panes: () => host.__herdrPanes?.() ?? [],
  props: () => host.__herdrProps?.(),
  run: (...args: unknown[]) => host.__herdrRun?.(...args) ?? null,
  setShared: (key: string, value: unknown) => host.__herdrSetShared?.(key, value) ?? null,
  settings: () => (host.__herdrSettings ? host.__herdrSettings() : {}),
  shared: (key: string) => host.__herdrShared?.(key),
  spaces: () => host.__herdrSpaces?.() ?? [],
  theme: () =>
    host.__herdrTheme
      ? host.__herdrTheme()
      : {
          surface: "#111111",
          border: "#222222",
          hover: "#333333",
          muted: "#444444",
          foreground: "#555555",
          raised: "#666666",
          dim: "#777777",
          popover: "#888888",
          background: "#999999",
        },
  window: () => (host.__herdrWindow ? host.__herdrWindow() : { platform: "linux" }),
}));
vi.mock("../../../src/shared/clip.ts", () => ({
  copyText: (value: string) => elements.copied.push(value),
}));
vi.mock("../../../src/primitives/icon-button.ts", () => ({
  IconButton: (
    id: string,
    label: string,
    glyph: unknown,
    options: { onClick: (...args: unknown[]) => void },
  ) => {
    const node = builder("button");
    node.calls.push(
      ["id", [id]],
      ["accessibility_label", [label]],
      ["on_click", [options.onClick]],
      ["child", [glyph]],
    );
    return node;
  },
}));

function allNodes(root: object): Node[] {
  const found: Node[] = [];
  const seen = new Set<object>();
  const visit = (node: unknown) => {
    if (!isNode(node) || seen.has(node)) return;
    seen.add(node);
    found.push(node);
    for (const [name, args] of node.calls) {
      if (name === "child") visit(args[0]);
      if (name === "children" && Array.isArray(args[0])) args[0].forEach(visit);
    }
  };
  visit(root);
  return found;
}

function callsOf(node: object): Call[] {
  return asNode(node).calls;
}

function callback(node: object, name: string): ((...args: unknown[]) => unknown) | undefined {
  const value = callsOf(node).find(([method]) => method === name)?.[1][0];
  return isCallback(value) ? value : undefined;
}

function nodeById(root: object, id: string): Node | undefined {
  return allNodes(root).find((node) =>
    node.calls.some(([name, args]) => name === "id" && args[0] === id),
  );
}

function textIn(root: object): string[] {
  const values: string[] = [];
  for (const node of allNodes(root)) {
    if (node.name === "svg") values.push(String(node.args[0]));
    for (const [name, args] of node.calls)
      if (name === "child" && typeof args[0] === "string") values.push(args[0]);
  }
  return values;
}

const calls: unknown[][] = [];
const notices: unknown[] = [];
const overlays: OverlaySpec[] = [];
const closedOverlays: (string | undefined)[] = [];
const sharedWrites: [string, unknown][] = [];
const commands: [string, string[]][] = [];
const emptyContext = {} as Context;
const ports = () => new Ports();

function context(): AsyncContext {
  return {
    notify: () => {
      calls.push(["notify"]);
    },
    timer: {
      every: (ms: number, handler: (cx: AsyncContext) => void) => {
        calls.push(["every", ms, handler]);
      },
    },
    spawn: (job: (cx: AsyncContext) => unknown) => {
      calls.push(["spawn"]);
      void job(context());
    },
  } as AsyncContext;
}

function port(overrides: Partial<Port> = {}): Port {
  return {
    id: "localhost:5173:42",
    pid: 42,
    processName: "node",
    bindHost: "*",
    connectHost: "localhost",
    port: 5173,
    protocol: "http",
    kind: "workspace",
    owner: { spaceId: "space-a", displayName: "Alpha" },
    ...overrides,
  };
}

afterEach(() => {
  for (const key of [
    "__herdrChecking",
    "__herdrExec",
    "__herdrShared",
    "__herdrSetShared",
    "__herdrProps",
    "__herdrSpaces",
    "__herdrPanes",
    "__herdrOpenOverlay",
    "__herdrCloseOverlay",
    "__herdrNotify",
    "__herdrRun",
    "__herdrWindow",
    "__herdrSettings",
    "__herdrTheme",
    "__herdrNextCommand",
    "__clipboard_write_text",
  ] as const)
    Reflect.deleteProperty(host, key);
  Reflect.deleteProperty(globalThis, "window");
  elements.created.length = 0;
  elements.copied.length = 0;
  calls.length = 0;
  notices.length = 0;
  overlays.length = 0;
  closedOverlays.length = 0;
  sharedWrites.length = 0;
  commands.length = 0;
});

function configureHost(): void {
  host.__herdrChecking = () => true;
  host.__herdrProps = () => ({ panel: true, overlay: "overlay-a", anchor: { x: 12, bottom: 700 } });
  host.__herdrShared = () => undefined;
  host.__herdrSetShared = (key, value) => sharedWrites.push([key, value]);
  host.__herdrExec = async (command, args = []) => {
    commands.push([command, args]);
    return { code: 0, stdout: "" };
  };
  host.__herdrSpaces = () => [
    { id: "space-a", name: "Alpha", folder: "/repo/alpha", machine: null, tabs: [] },
  ];
  host.__herdrPanes = () => [];
  host.__herdrOpenOverlay = (spec) => {
    overlays.push(spec);
    return "overlay-next";
  };
  host.__herdrCloseOverlay = (id) => closedOverlays.push(id);
  host.__herdrNotify = (value) => notices.push(value);
  host.__herdrRun = (...args) => calls.push(args);
  host.__herdrWindow = () => ({ platform: "linux" });
  host.__herdrSettings = () => ({ font_family: "Mono" });
}

it("uses a fresh cache during checking and drops stale or unreadable timestamps", () => {
  configureHost();
  const current = port();
  const instance = ports();
  host.__herdrShared = () => ({ at: Date.now() - 100, ports: [current] });
  instance.init(undefined, context());
  assert.deepEqual(instance.ports, [current]);
  assert.equal(commands.length, 0);

  for (const cache of [
    { at: Date.now() - 31_000, ports: [current] },
    { at: "now", ports: [current] },
    null,
  ]) {
    host.__herdrShared = () => cache;
    const next = ports();
    next.init(undefined, context());
    assert.deepEqual(next.ports, []);
  }
});

it("hands a fresh cache with malformed port entries to the first render unchanged", () => {
  configureHost();
  const current = port();
  const malformed = [
    { ...current, id: 1 },
    { ...current, port: "5173" },
    { ...current, pid: "42" },
    { ...current, processName: 3 },
    { ...current, bindHost: 1 },
    { ...current, connectHost: 1 },
    { ...current, kind: "bogus" },
    { ...current, protocol: "ftp" },
    { ...current, owner: "Alpha" },
    { ...current, owner: { spaceId: "space-a" } },
    null,
  ];
  for (const entry of malformed) {
    host.__herdrShared = () => ({ at: Date.now(), ports: [entry] });
    const next = ports();
    next.init(undefined, context());
    assert.deepEqual(next.ports, [entry]);
    assert.equal(next.ports[0], entry);
  }
  const unattributed = port({ pid: null, processName: null, owner: undefined });
  host.__herdrShared = () => ({ at: Date.now(), ports: [unattributed] });
  const kept = ports();
  kept.init(undefined, context());
  assert.deepEqual(kept.ports, [unattributed]);
});

it("initializes panel views without timers or command listeners and the status button with both", async () => {
  configureHost();
  const panel = ports();
  panel.init(undefined, context());
  assert.equal(
    calls.some(([kind]) => kind === "every"),
    false,
  );
  assert.equal(
    calls.some(([kind]) => kind === "spawn"),
    false,
  );

  calls.length = 0;
  host.__herdrProps = () => ({ panel: false });
  host.__herdrChecking = () => false;
  const button = ports();
  button.init(undefined, context());
  assert.ok(calls.some(([kind, duration]) => kind === "every" && duration === 30_000));
  assert.ok(calls.some(([kind]) => kind === "spawn"));
  const tick = calls.find(([kind]) => kind === "every")?.[2];
  if (isCallback(tick)) tick(context());
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(button.isPanel(), false);
});

it("accepts missing props and runs its init refresh before returning for a non-checking panel", async () => {
  configureHost();
  host.__herdrProps = () => null;
  assert.equal(ports().isPanel(), false);
  host.__herdrChecking = () => false;
  host.__herdrProps = () => ({ panel: true });
  const instance = ports();
  instance.init(undefined, context());
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(commands.length, 1);
  assert.equal(
    calls.some(([kind]) => kind === "every"),
    false,
  );
});

it("handles open, refresh and unknown commands from Herdr's view command stream", async () => {
  configureHost();
  host.__herdrChecking = () => false;
  host.__herdrProps = () => ({ panel: false });
  let index = 0;
  const queue = ["unknown", "open", "refresh"];
  host.__herdrNextCommand = async () => queue[index++] ?? new Promise<string>(() => {});
  const instance = ports();
  instance.init(undefined, context());
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(overlays.length, 1);
  assert.equal(commands.length, 2);
});

it("refreshes once while a scan is in flight and skips the cwd query when no process is listening", async () => {
  configureHost();
  let finish!: (value: { code: number; stdout: string }) => void;
  host.__herdrExec = async (command, args = []) => {
    commands.push([command, args]);
    return new Promise((resolve) => {
      finish = resolve;
    });
  };
  const instance = ports();
  const cx = context();
  const pending = instance.refresh(cx);
  await instance.refresh(cx);
  assert.equal(commands.length, 1);
  finish({ code: 0, stdout: "" });
  await pending;
  assert.deepEqual(instance.ports, []);
  assert.equal(instance.scanning, false);
  assert.equal(commands.length, 1);
  assert.equal(sharedWrites.length, 1);
});

it("queries cwd for listening PIDs, assigns workspace ports, and writes cache only when the signature changes", async () => {
  configureHost();
  const outputByArgs = new Map<string, string>([
    ["-O -nP -iTCP -sTCP:LISTEN -Fpcn", "p42\ncnode\nn*:5173\np99\ncvite\nn127.0.0.1:8080"],
    ["-O -a -p 42,99 -d cwd -Fn", "p42\nn/repo/alpha\np99\n/tmp/external"],
  ]);
  host.__herdrExec = async (command, args = []) => {
    commands.push([command, args]);
    return { code: 0, stdout: outputByArgs.get(args.join(" ")) ?? "" };
  };
  const instance = ports();
  await instance.refresh(context());
  assert.equal(commands.length, 2);
  assert.equal(instance.ports[0].kind, "workspace");
  assert.equal(instance.ports[1].kind, "external");
  assert.equal(sharedWrites.length, 1);
  await instance.refresh(context());
  assert.equal(sharedWrites.length, 1);
  assert.equal(calls.filter(([kind]) => kind === "notify").length, 4);
});

it("shows scan failures, clears the scanning flag and notifies after the rejected host command", async () => {
  configureHost();
  host.__herdrExec = async () => {
    throw new Error("lsof unavailable");
  };
  const instance = ports();
  await instance.refresh(context());
  assert.equal(instance.scanning, false);
  assert.equal(instance.scanError, "lsof unavailable");
  assert.equal(calls.filter(([kind]) => kind === "notify").length, 2);
});

it("renders accessible status and workspace/external sections with row actions", async () => {
  configureHost();
  const instance = ports();
  instance.scanned = [
    port(),
    port({
      id: "localhost:3000:43",
      pid: 43,
      processName: "vite",
      port: 3000,
      owner: { spaceId: "space-b", displayName: "Beta" },
    }),
    port({
      id: "remote:8080:99",
      pid: null,
      processName: null,
      port: 8080,
      connectHost: "remote",
      kind: "external",
      owner: undefined,
    }),
  ];
  instance.externalOpen = true;
  instance.hoveredPort = instance.scanned[0].id;
  const panel = instance.renderPanel(emptyContext);
  const text = textIn(panel).join(" ");
  assert.match(text, /Alpha/);
  assert.match(text, /Beta/);
  assert.match(text, /5173/);
  assert.match(text, /EXTERNAL PORTS/);
  assert.match(text, /Unknown process/);
  assert.ok(nodeById(panel, "port-localhost:5173:42"));
  assert.ok(nodeById(panel, "open-localhost:5173:42"));
  assert.ok(nodeById(panel, "copy-localhost:5173:42"));
  assert.ok(nodeById(panel, "stop-localhost:5173:42"));
  assert.ok(nodeById(panel, "port-remote:8080:99"));
  const secondGroupAction = nodeById(panel, "go-space-b");
  callback(secondGroupAction!, "on_click")?.();
  assert.deepEqual(calls.at(-1), ["space.select", { id: "space-b" }]);
  callback(nodeById(panel, "open-localhost:5173:42")!, "on_click")?.();
  callback(nodeById(panel, "copy-localhost:5173:42")!, "on_click")?.({}, emptyContext);
  callback(nodeById(panel, "stop-localhost:5173:42")!, "on_click")?.({}, context());
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(elements.copied, ["localhost:5173"]);
  const priorNotifyCount = calls.filter(([kind]) => kind === "notify").length;
  const hover = callback(nodeById(panel, "port-localhost:5173:42")!, "on_hover");
  instance.hoveredPort = null;
  hover?.(true, context());
  assert.equal(instance.hoveredPort, "localhost:5173:42");
  hover?.(false, context());
  assert.equal(instance.hoveredPort, null);
  assert.equal(calls.filter(([kind]) => kind === "notify").length - priorNotifyCount, 2);
  callback(nodeById(panel, "external-ports-toggle")!, "on_click")?.();
  assert.equal(overlays.length, 1);
  callback(nodeById(panel, "ports-close")!, "on_click")?.();
  assert.ok(closedOverlays.includes("overlay-a"));
});

it("shows the empty external section and preserves non-hex theme border colors", () => {
  configureHost();
  host.__herdrTheme = () => ({
    surface: "#111111",
    border: "var(--border)",
    hover: "#333333",
    muted: "#444444",
    foreground: "#555555",
    raised: "#666666",
    dim: "#777777",
    popover: "#888888",
    background: "#999999",
  });
  const instance = ports();
  instance.scanned = [port()];
  instance.externalOpen = true;
  const panel = instance.renderPanel(emptyContext);
  assert.match(textIn(panel).join(" "), /No external ports detected/);
  assert.ok(
    elements.created.some((node) =>
      node.calls.some(([name, args]) => name === "border_color" && args[0] === "var(--border)"),
    ),
  );
});

it("renders scan errors, active scans and a settled empty result", () => {
  configureHost();
  const instance = ports();
  instance.scanning = true;
  assert.match(
    textIn(instance.renderPanel(emptyContext)).join(" "),
    /Scanning for workspace ports/,
  );
  instance.scanning = false;
  instance.scanned = [];
  assert.match(textIn(instance.renderPanel(emptyContext)).join(" "), /No workspace ports detected/);
  instance.scanError = "permission denied";
  assert.match(
    textIn(instance.renderPanel(emptyContext)).join(" "),
    /Port scan unavailable: permission denied/,
  );
  host.__herdrProps = () => ({ panel: true });
  assert.ok(instance.render(emptyContext));
  host.__herdrProps = () => ({ panel: false });
  assert.ok(instance.render(emptyContext));
});

it("opens the measured panel, replaces an existing overlay, and stores its new id", () => {
  configureHost();
  host.__herdrShared = (key) => (key === "orca-status-ports.overlay" ? "overlay-old" : undefined);
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { viewport_size: () => ({ width: 1280, height: 800 }) },
  });
  const instance = ports();
  instance.scanned = [port()];
  instance.openPanel();
  assert.deepEqual(closedOverlays, ["overlay-old"]);
  const spec = overlays[0] as {
    width: number;
    height: number;
    at: { x: number; y: number };
    props: { anchor: { x: number; bottom: number } };
  };
  assert.equal(spec.width, 384);
  assert.equal(spec.at.x, 888);
  assert.equal(spec.props.anchor.bottom, 772);
  assert.deepEqual(sharedWrites.at(-1), ["orca-status-ports.overlay", "overlay-next"]);
});

it("falls back only for a missing window or dimension and coerces numeric strings", () => {
  configureHost();
  const instance = ports();
  instance.scanned = [port()];
  const cases = [
    { viewport: undefined, x: 1048, bottom: 872 },
    { viewport: { viewport_size: undefined }, x: 1048, bottom: 872 },
    { viewport: { viewport_size: () => undefined }, x: 1048, bottom: 872 },
    { viewport: { viewport_size: () => null }, x: 1048, bottom: 872 },
    { viewport: { viewport_size: () => ({ width: 1280 }) }, x: 888, bottom: 872 },
    { viewport: { viewport_size: () => ({ height: 800, width: null }) }, x: 1048, bottom: 772 },
    { viewport: { viewport_size: () => ({ width: "1280", height: 800 }) }, x: 888, bottom: 772 },
  ];
  for (const { viewport, x, bottom } of cases) {
    overlays.length = 0;
    Object.defineProperty(globalThis, "window", { configurable: true, value: viewport });
    instance.openPanel();
    assert.equal(overlays.at(-1)?.width, 384);
    assert.deepEqual(overlays.at(-1)?.props, {
      panel: true,
      externalOpen: false,
      anchor: { x, bottom },
    });
  }
});

it("opens the panel from its status button callback with fallback viewport dimensions", () => {
  configureHost();
  host.__herdrProps = () => ({ panel: false });
  Object.defineProperty(globalThis, "window", { configurable: true, value: undefined });
  const instance = ports();
  instance.scanned = [port({ kind: "external", owner: undefined })];
  const button = instance.renderButton(emptyContext);
  const id = nodeById(button, "orca-ports-button");
  assert.ok(
    callsOf(id!).some(
      ([name, args]) => name === "tooltip" && String(args[0]).includes("1 external"),
    ),
  );
  const onClick = callback(id!, "on_click");
  assert.equal(typeof onClick, "function");
  onClick?.();
  assert.equal(overlays.length, 1);
});

it("toggles external ports with the original anchor, closes safely without one, and navigates to a worktree", () => {
  configureHost();
  host.__herdrProps = () => ({ panel: true });
  const instance = ports();
  instance.scanned = [port()];
  instance.toggleExternal();
  assert.equal(instance.externalOpen, true);
  assert.equal(overlays.length, 0);
  host.__herdrProps = () => ({ overlay: "overlay-a" });
  instance.toggleExternal();
  assert.equal(overlays[0]?.at, "pointer");
  host.__herdrProps = () => ({ overlay: "overlay-a", anchor: { x: 24, bottom: 700 } });
  instance.toggleExternal();
  assert.deepEqual(closedOverlays, ["overlay-a", "overlay-a"]);
  assert.deepEqual(overlays[1]?.at, { x: 24, y: 552 });
  instance.goToSpace("space-a");
  assert.deepEqual(calls.at(-1), ["space.select", { id: "space-a" }]);
});

it("closes the panel overlay even when none is set, and picks the platform browser command", async () => {
  configureHost();
  host.__herdrProps = () => ({ panel: true });
  const instance = ports();
  instance.closePanel();
  assert.deepEqual(closedOverlays, [undefined]);
  host.__herdrProps = () => ({ overlay: "overlay-a" });
  instance.closePanel();
  assert.deepEqual(closedOverlays, [undefined, "overlay-a"]);
  host.__herdrWindow = () => ({ platform: "macos" });
  instance.openInBrowser(port());
  host.__herdrWindow = () => ({ platform: "linux" });
  instance.openInBrowser(port({ protocol: "https", port: 8443 }));
  await Promise.resolve();
  assert.deepEqual(commands, [
    ["open", ["http://localhost:5173"]],
    ["xdg-open", ["https://localhost:8443"]],
  ]);
});

it("reports failed browser launches and copies formatted addresses with a success notice", async () => {
  configureHost();
  host.__herdrWindow = () => ({ platform: "macos" });
  host.__herdrExec = async (command, args = []) => {
    commands.push([command, args]);
    if (command === "open") throw new Error("browser unavailable");
    return { code: 0, stdout: "" };
  };
  const instance = ports();
  instance.openInBrowser(port());
  instance.copyAddress(port({ connectHost: "2001:db8::1" }), emptyContext);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(elements.copied, ["[2001:db8::1]:5173"]);
  assert.match(JSON.stringify(notices), /Failed to open browser/);
  assert.match(JSON.stringify(notices), /Copied \[2001:db8::1\]:5173/);
});

it("stops only eligible workspace processes and reports success or failure", async () => {
  configureHost();
  const instance = ports();
  const workspace = port();
  const electron = port({ id: "electron", processName: "Electron" });
  const external = port({ id: "external", kind: "external", owner: undefined });
  const noPid = port({ id: "no-pid", pid: null });
  assert.equal(instance.canStop(workspace), true);
  assert.equal(instance.canStop(electron), false);
  assert.equal(instance.canStop(external), false);
  assert.equal(instance.canStop(noPid), false);
  instance.stop(external, context());
  assert.equal(commands.length, 0);
  instance.stop(workspace, context());
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(commands.some(([command, args]) => command === "/bin/kill" && args[1] === "42"));
  assert.match(JSON.stringify(notices), /Stopped process on :5173/);

  host.__herdrExec = async (command, args = []) => {
    commands.push([command, args]);
    if (command === "/bin/kill") throw new Error("permission denied");
    return { code: 0, stdout: "" };
  };
  instance.stop(workspace, context());
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.match(JSON.stringify(notices), /Could not stop :5173/);
});

it("renders a never-initialized instance as an unset list, not as a scan in progress", () => {
  configureHost();
  const fresh = ports();
  assert.equal(fresh.scanned, undefined);
  assert.match(textIn(fresh.renderPanel(emptyContext)).join(" "), /No workspace ports detected/);
});

it("treats an infinite cache timestamp as legacy did: +Infinity is fresh, -Infinity is not", () => {
  configureHost();
  const current = port();
  host.__herdrShared = () => ({ at: Infinity, ports: [current] });
  const past = ports();
  past.init(undefined, context());
  assert.deepEqual(past.ports, [current]);
  host.__herdrShared = () => ({ at: -Infinity, ports: [current] });
  const future = ports();
  future.init(undefined, context());
  assert.deepEqual(future.ports, []);
});

it("hands a fresh cache with a non-list port field to the first render as stored", () => {
  configureHost();
  host.__herdrShared = () => ({ at: Date.now(), ports: "bad" });
  const instance = ports();
  instance.init(undefined, context());
  assert.equal(instance.ports, "bad");
  const button = instance.renderButton(emptyContext);
  assert.ok(
    callsOf(nodeById(button, "orca-ports-button")!).some(
      ([name, args]) =>
        name === "tooltip" && String(args[0]).includes("0 workspace ports · 3 external"),
    ),
  );
});

it("treats a fresh cache with no port list as an unset list, not as a scan in progress", () => {
  configureHost();
  host.__herdrShared = () => ({ at: Date.now() });
  const instance = ports();
  instance.init(undefined, context());
  assert.deepEqual(instance.ports, []);
  assert.match(textIn(instance.renderPanel(emptyContext)).join(" "), /No workspace ports detected/);
});

it("reads the panel and external flags only when they are literally true", () => {
  configureHost();
  host.__herdrProps = () => ({ panel: "true", externalOpen: "true" });
  const closed = ports();
  closed.init(undefined, context());
  assert.equal(closed.isPanel(), false);
  assert.equal(closed.externalOpen, false);
  host.__herdrProps = () => ({ panel: true, externalOpen: true });
  const open = ports();
  open.init(undefined, context());
  assert.equal(open.externalOpen, true);
});

it("keeps the viewport's raw values, so non-numeric sizes give NaN and a non-function reader throws", () => {
  configureHost();
  const instance = ports();
  instance.scanned = [port()];
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { viewport_size: () => ({ width: "wide", height: "tall" }) },
  });
  instance.openPanel();
  assert.deepEqual(overlays.at(-1)?.at, { x: NaN, y: NaN });
  assert.deepEqual(overlays.at(-1)?.props, {
    panel: true,
    externalOpen: false,
    anchor: { x: NaN, bottom: NaN },
  });
  Object.defineProperty(globalThis, "window", { configurable: true, value: { viewport_size: 5 } });
  assert.throws(() => instance.openPanel(), TypeError);
  assert.equal(overlays.length, 1);
});

it("closes a previous overlay only when its stored id is truthy", () => {
  configureHost();
  const instance = ports();
  instance.scanned = [port()];
  host.__herdrShared = () => "";
  instance.openPanel();
  assert.deepEqual(closedOverlays, []);
  host.__herdrShared = () => 7;
  instance.openPanel();
  assert.deepEqual(closedOverlays, [7]);
});

it("places a toggled panel from the anchor the host passes, without checking its fields", () => {
  configureHost();
  host.__herdrProps = () => ({ overlay: "overlay-a", anchor: { x: 1 } });
  const partial = ports();
  partial.scanned = [port()];
  partial.toggleExternal();
  assert.deepEqual(overlays.at(-1)?.at, { x: 1, y: NaN });
  assert.deepEqual(overlays.at(-1)?.props, { panel: true, externalOpen: true, anchor: { x: 1 } });
  host.__herdrProps = () => ({ overlay: "overlay-a", anchor: null });
  const cleared = ports();
  cleared.scanned = [port()];
  cleared.toggleExternal();
  assert.equal(overlays.at(-1)?.at, "pointer");
  assert.deepEqual(overlays.at(-1)?.props, { panel: true, externalOpen: true, anchor: null });
});

it("throws when the host window is missing, as the legacy platform read did", () => {
  configureHost();
  host.__herdrWindow = () => null;
  const instance = ports();
  assert.throws(() => instance.openInBrowser(port()), TypeError);
  assert.deepEqual(commands, []);
});

it("reads the font family as the host reports it and defaults only when it is absent", () => {
  configureHost();
  const instance = ports();
  host.__herdrSettings = () => ({ font_family: 5 });
  assert.equal(instance.mono(), 5);
  host.__herdrSettings = () => ({ font_family: "" });
  assert.equal(instance.mono(), "");
  host.__herdrSettings = () => ({});
  assert.equal(instance.mono(), "JetBrains Mono");
  host.__herdrSettings = () => null;
  assert.equal(instance.mono(), "JetBrains Mono");
});

it("fails on a missing theme and writes an empty separator colour for a missing border token", () => {
  configureHost();
  host.__herdrTheme = () => null;
  const instance = ports();
  instance.scanned = [port()];
  instance.externalOpen = true;
  assert.throws(() => instance.renderPanel(emptyContext), TypeError);
  host.__herdrTheme = () => ({
    surface: "#111111",
    hover: "#333333",
    muted: "#444444",
    foreground: "#555555",
    raised: "#666666",
    dim: "#777777",
    popover: "#888888",
    background: "#999999",
  });
  instance.renderPanel(emptyContext);
  assert.ok(
    elements.created.some((node) =>
      node.calls.some(([name, args]) => name === "border_color" && args[0] === ""),
    ),
  );
});

it("records scan errors with the legacy message fallbacks", async () => {
  configureHost();
  const cases: [unknown, string][] = [
    [new Error("lsof unavailable"), "lsof unavailable"],
    [{ message: "custom" }, "custom"],
    [{}, "[object Object]"],
    ["plain", "plain"],
    [undefined, "port scan failed"],
    [null, "port scan failed"],
  ];
  for (const [error, expected] of cases) {
    host.__herdrExec = async () => {
      throw error;
    };
    const instance = ports();
    await instance.refresh(context());
    assert.equal(instance.scanError, expected);
  }
});

it("turns rejected browser and stop commands into notices with the legacy message fallbacks", async () => {
  configureHost();
  host.__herdrWindow = () => ({ platform: "macos" });
  const instance = ports();
  host.__herdrExec = async () => {
    throw { message: "no browser" };
  };
  instance.openInBrowser(port());
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(notices.at(-1), {
    title: "Failed to open browser",
    body: "no browser",
    level: "error",
  });
  host.__herdrExec = async () => {
    throw undefined;
  };
  instance.openInBrowser(port());
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(notices.at(-1), {
    title: "Failed to open browser",
    body: "undefined",
    level: "error",
  });
  host.__herdrExec = async () => {
    throw { message: "denied" };
  };
  instance.stop(port(), context());
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(notices.at(-1), {
    title: "Could not stop :5173",
    body: "denied",
    level: "error",
  });
  host.__herdrExec = async () => {
    throw "stop refused";
  };
  instance.stop(port(), context());
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(notices.at(-1), {
    title: "Could not stop :5173",
    body: "stop refused",
    level: "error",
  });
});

it("renders the singular port count, the scanning spinner and the unnamed workspace fallback", () => {
  configureHost();
  const instance = ports();
  instance.scanned = [port({ owner: { spaceId: "space-a", displayName: "" } })];
  const button = instance.renderButton(emptyContext);
  assert.ok(
    callsOf(nodeById(button, "orca-ports-button")!).some(
      ([name, args]) => name === "accessibility_label" && args[0] === "Ports, 1 workspace port",
    ),
  );
  assert.ok(
    callsOf(nodeById(button, "orca-ports-button")!).some(
      ([name, args]) => name === "tooltip" && args[0] === "Ports — 1 workspace port",
    ),
  );
  instance.scanned = [port(), port({ id: "remote:8080:99", kind: "external", owner: undefined })];
  const crowded = instance.renderButton(emptyContext);
  assert.ok(
    callsOf(nodeById(crowded, "orca-ports-button")!).some(
      ([name, args]) => name === "tooltip" && args[0] === "Ports — 1 workspace port · 1 external",
    ),
  );
  instance.scanning = true;
  assert.ok(
    textIn(instance.renderButton(emptyContext)).some((value) => value.includes("loader-circle")),
  );
  instance.scanning = false;
  instance.scanned = [port({ owner: { spaceId: "space-a", displayName: "" } })];
  assert.ok(textIn(instance.renderPanel(emptyContext)).includes("Workspace"));
});

it("tracks the hovered row only when it changes, names an unnamed process by PID, and offers Stop only for workspace ports", () => {
  configureHost();
  const instance = ports();
  const workspace = port();
  const external = port({
    id: "remote:8080:99",
    pid: 99,
    processName: null,
    port: 8080,
    connectHost: "remote",
    kind: "external",
    owner: undefined,
  });
  instance.scanned = [workspace, external];
  instance.externalOpen = true;
  instance.hoveredPort = external.id;
  const panel = instance.renderPanel(emptyContext);
  assert.ok(textIn(panel).includes("PID 99"));
  assert.equal(nodeById(panel, "stop-remote:8080:99"), undefined);
  const hover = (id: string) => callback(nodeById(panel, `port-${id}`)!, "on_hover");
  hover(workspace.id)?.(true, context());
  assert.equal(instance.hoveredPort, workspace.id);
  hover(external.id)?.(false, context());
  assert.equal(instance.hoveredPort, workspace.id);
  hover(workspace.id)?.(false, context());
  assert.equal(instance.hoveredPort, null);
});
