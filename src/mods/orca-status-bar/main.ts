import { View, div, image, svg, type Color, type NativeElement } from "gpui-kit";
import { h_flex } from "gpui-base";
import {
  appHome,
  checking,
  exec,
  hc,
  home,
  keys,
  knownAgents,
  machines,
  nextCommand,
  notify,
  panes,
  readTextFile,
  run,
  setShared,
  shared,
  spaces,
  theme,
  updates,
  watchFolder,
  type PaneInfo,
} from "herdr";
import { themeColor } from "../../shared/theme-color.js";
import { SPIN_PERIOD_MS } from "../../shared/ui-settings.js";
import { gatewayReadings } from "./gateway-usage.js";
import { probeLocal } from "./local-usage.js";
import {
  FOLLOW_EVERY_MS,
  FOLLOW_STATE_KEY,
  parseCheckout,
  planFollow,
  type Checkout,
  type Move,
  type SpaceRef,
} from "./wt-follow.js";
import {
  formatBucketChipLabel,
  getTightestUsageBucket,
  isRecord,
  probeAllProviders,
  type UsageBucket,
  type UsageReading,
} from "./usage.js";

type Mark = { path: string; image?: boolean };

const MARKS: Partial<Record<string, Mark>> = {
  antigravity: { path: "antigravity.png", image: true },
  commandcode: { path: "command-code.svg" },
  "github-copilot": { path: "copilot.svg" },
  claude: { path: "claude.svg" },
  anthropic: { path: "claude.svg" },
  codex: { path: "codex.svg" },
  openai: { path: "codex.svg" },
  opencode: { path: "opencode.svg" },
  cursor: { path: "cursor.png", image: true },
  omp: { path: "omp.svg", image: true },
};

const ORDER = [
  "antigravity",
  "claude",
  "anthropic",
  "codex",
  "openai",
  "opencode",
  "commandcode",
  "github-copilot",
  "cursor",
];

const rank = (provider: string): number => {
  const i = ORDER.indexOf(provider);
  return i === -1 ? ORDER.length : i;
};

const HOUR_S = 3600;
const DAY_S = 86400;

const resetIn = (iso: string | null | undefined): string => {
  if (!iso) return "";
  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp)) return "";
  const s = Math.max(0, Math.round((timestamp - Date.now()) / 1000));
  if (s < HOUR_S) return `${Math.floor(s / 60)}m`;
  if (s < DAY_S) return `${Math.floor(s / HOUR_S)}h ${Math.floor((s % HOUR_S) / 60)}m`;
  return `${Math.floor(s / DAY_S)}d ${Math.floor((s % DAY_S) / HOUR_S)}h`;
};

const letterFor = (provider: string): string => (provider.trim()[0] ?? "?").toUpperCase();

const WATCHED_DIRS = (h: string): string[] => [
  `${h}/.cache/herdr-usage`,
  `${h}/.codex/sessions`,
  `${h}/.local/share/opencode`,
];

const MIN_REFRESH_MS = 2000;
const FALLBACK_MS = 300000;
const FOLLOW_TTL_MS = 60000;
const FOLLOW_POLL_MS = 50;
const FOLLOW_WAIT_MS = 4000;

const SHARED_ASSET_PATHS: Record<string, string> = {
  "mods/orca-status-bar/codex.svg": "mods/orca-assets/codex--orca-status-bar.svg",
};

function sharedAsset(path: string): string {
  return SHARED_ASSET_PATHS[path] ?? `mods/orca-assets/${path.slice(path.lastIndexOf("/") + 1)}`;
}

export type Cx = {
  notify(): void;
  sleep(ms: number): Promise<void>;
  spawn(job: (cx: Cx) => unknown): unknown;
  timer: { every(ms: number, fn: (cx: Cx) => unknown): unknown };
};

type StatusTheme = Record<
  "surface" | "border" | "raised" | "hover" | "foreground" | "muted" | "blocked" | "done",
  Color
>;

type SegmentOptions = { muted?: boolean; on?: () => void; iconColor?: Color; spin?: boolean };

type KnownSpace = SpaceRef & { checkout: Checkout | null };

type TargetSpace = { id: string };

type AgentPane = { terminal: string; cwd?: string | null };

type Part = [string | null, string];

function statusTheme(): StatusTheme {
  const t = theme();
  return {
    surface: themeColor(t.surface),
    border: themeColor(t.border),
    raised: themeColor(t.raised),
    hover: themeColor(t.hover),
    foreground: themeColor(t.foreground),
    muted: themeColor(t.muted),
    blocked: themeColor(t.blocked),
    done: themeColor(t.done),
  };
}

function movedState(): Record<string, unknown> {
  return (shared(FOLLOW_STATE_KEY) ?? {}) as Record<string, unknown>;
}

const isAgentPane = (p: PaneInfo): p is PaneInfo & { terminal: string } =>
  Boolean(p.terminal && p.program?.agent);

const isPresent = (value: string | null): value is string => Boolean(value);

function foregroundCwd(stdout: string): string | null {
  const parsed: unknown = JSON.parse(stdout);
  const foreground = isRecord(parsed) ? parsed.foreground : undefined;
  const cwd = isRecord(foreground) ? foreground.cwd : undefined;
  return (cwd ?? null) as string | null;
}

async function till(cx: Cx, ok: () => boolean, ms = FOLLOW_WAIT_MS): Promise<boolean> {
  for (let i = 0; i < ms / FOLLOW_POLL_MS; i++) {
    if (ok()) return true;
    await cx.sleep(FOLLOW_POLL_MS);
  }
  return ok();
}

async function ensureTargetSpace(
  move: Move,
  known: KnownSpace[],
  cx: Cx,
): Promise<{ target: TargetSpace; spareTab: string | null } | null> {
  const existing = known.find((s) => s.checkout?.top === move.to);
  if (existing) return { target: existing, spareTab: null };
  run("space.new", { folder: move.to, focus: false });
  await till(cx, () => (spaces() ?? []).some((s) => s.folder === move.to));
  const target = (spaces() ?? []).find((s) => s.folder === move.to);
  if (!target) return null;
  return { target, spareTab: (target.tabs ?? [])[0]?.id ?? null };
}

function landedTab(move: Move, target: TargetSpace): string | null {
  const tab = (panes() ?? []).find((p) => p.terminal === move.terminal)?.tab;
  const space = (spaces() ?? []).find((s) => s.id === target.id);
  return tab && (space?.tabs ?? []).some((t) => t.id === tab) ? tab : null;
}

async function moveTerminalInto(move: Move, target: TargetSpace, cx: Cx): Promise<string | null> {
  const source = (spaces() ?? []).find((s) => s.id === move.from.space);
  if (move.from.onlyTerminal && source)
    run("tab.new", { space: source.id, folder: source.folder, focus: false });
  run("space.select", { id: target.id });
  await till(cx, () => (spaces() ?? []).find((s) => s.active)?.id === target.id);
  run("terminal.park", { terminal: move.terminal });
  await till(cx, () => !(panes() ?? []).some((p) => p.terminal === move.terminal));
  run("terminal.keep", { terminal: move.terminal, place: "tab" });
  const landed = () => landedTab(move, target);
  if (landed()) return landed();
  await till(cx, () => Boolean(landed()));
  return landed();
}

function finishMove(
  move: Move,
  tabId: string,
  spareTab: string | null,
  before: string | null,
): void {
  run("tab.rename", { id: tabId, name: move.from.tabName || move.app });
  if (spareTab && spareTab !== tabId) run("tab.close", { id: spareTab });
  setShared(FOLLOW_STATE_KEY, { ...movedState(), [move.terminal]: move.to });
  if (!move.from.active && before) run("space.select", { id: before });
  notify({
    title: `${move.app} is in ${move.branch || move.to.split("/").pop()}`,
    body: `Its tab moved to ${move.to}.`,
    level: "success",
  });
}

function segment(
  t: StatusTheme,
  id: string,
  iconName: string,
  label: string,
  opts: SegmentOptions = {},
): NativeElement {
  return h_flex()
    .id(id)
    .gap(5)
    .px(3)
    .py(2)
    .rounded(3)
    .items_center()
    .text_size(9)
    .text_color(opts.muted ? t.muted : t.foreground)
    .when(Boolean(opts.on), (el) =>
      el
        .role("button")
        .accessibility_label(label)
        .tooltip(label)
        .cursor_pointer()
        .hover((s) => s.bg("#404040b3").text_color(t.foreground))
        .on_click(() => opts.on?.()),
    )
    .child(
      svg(
        iconName === "refresh-cw"
          ? "mods/orca-assets/refresh-cw.svg"
          : sharedAsset(`mods/orca-status-bar/${iconName}.svg`),
      )
        .size(10)
        .flex_none()
        .text_color(opts.iconColor ?? t.muted)
        .when(Boolean(opts.spin), (el) => el.spin(SPIN_PERIOD_MS)),
    )
    .child(label);
}

function floatToggle(t: StatusTheme): NativeElement {
  const floatOpen = shared("orca-float-workspace.open") === true;
  const floatAttention = !floatOpen && shared("orca-float-workspace.attention") === true;
  const floatLabel = floatOpen ? "Minimize Floating Workspace" : "Show Floating Workspace";
  const floatChord =
    (keys() ?? []).find((k) => k.action === "orca-float-workspace.toggle")?.keys ?? "";
  return div()
    .id("st-float")
    .relative()
    .size(17)
    .flex_none()
    .flex()
    .items_center()
    .justify_center()
    .rounded(3)
    .border_1()
    .border_color(t.border)
    .bg(t.raised)
    .text_color(t.foreground)
    .cursor_pointer()
    .hover((s) => s.bg(t.hover).text_color(t.foreground))
    .role("button")
    .accessibility_label(floatAttention ? `${floatLabel}, new activity` : floatLabel)
    .tooltip(floatChord ? `${floatLabel} (${floatChord})` : floatLabel)
    .on_click(() => run("orca-float-workspace.toggle"))
    .child(svg("mods/orca-assets/panels-top-left.svg").size(14).flex_none())
    .when(floatAttention, (el) =>
      el.child(
        div()
          .absolute()
          .top(2)
          .right(2)
          .size(5)
          .rounded_full()
          .flex_none()
          .bg("#f59e0b")
          .border_1()
          .border_color(t.raised),
      ),
    );
}

function mark(t: StatusTheme, provider: string, size: number): NativeElement {
  const m = MARKS[provider];
  if (m?.image)
    return image(sharedAsset(`mods/orca-status-bar/${m.path}`))
      .w(size)
      .h(size)
      .flex_none()
      .rounded(2);
  if (m)
    return svg(sharedAsset(`mods/orca-status-bar/${m.path}`))
      .size(size)
      .flex_none();
  return div()
    .size(size)
    .flex_none()
    .flex()
    .items_center()
    .justify_center()
    .text_size(9)
    .text_color(t.muted)
    .child(letterFor(provider));
}

const usageBar = (t: StatusTheme, usedPercent: number): NativeElement =>
  h_flex()
    .w(80)
    .h(5)
    .flex_none()
    .gap(2)
    .children(
      [0, 1, 2, 3, 4].map((i) =>
        div()
          .flex_1()
          .h(5)
          .rounded(2)
          .bg(t.raised)
          .child(
            div()
              .h(5)
              .rounded(2)
              .bg(t.foreground)
              .w(`${Math.min(100, Math.max(0, (usedPercent - i * 20) * 5))}%`),
          ),
      ),
    );

function detailPart([pct, rest]: Part): NativeElement {
  const badge: NativeElement[] =
    pct === null
      ? []
      : [
          div()
            .px(5)
            .py(1)
            .line_height(1.3)
            .rounded_full()
            .bg("#ffffff")
            .text_color("#000000")
            .child(pct),
        ];
  return h_flex().gap(4).items_center().children(badge).child(div().child(rest));
}

function detailParts(reading: UsageReading): Part[] {
  if (reading.text) return [[null, `${reading.text} ${resetIn(reading.resetTime)}`]];
  return reading.buckets.map((b: UsageBucket): Part => [
    `${b.usedPercent}%`,
    b.idleText ??
      (b.label === "5h" || b.label === "wk" ? resetIn(b.resetTime) : (b.label as string)),
  ]);
}

function detailChip(t: StatusTheme, reading: UsageReading): NativeElement {
  const first = reading.buckets[0];
  const parts = detailParts(reading);
  return h_flex()
    .gap(7)
    .items_center()
    .child(mark(t, reading.provider, 11))
    .children(first ? [usageBar(t, first.usedPercent)] : [])
    .child(
      h_flex()
        .gap(5)
        .items_center()
        .text_color(t.foreground)
        .children(
          parts.flatMap((x, i) =>
            i ? [div().text_color(t.muted).child("·"), detailPart(x)] : [detailPart(x)],
          ),
        ),
    );
}

function chip(t: StatusTheme, reading: UsageReading): NativeElement {
  if (reading.detail) {
    const view = detailChip(t, reading);
    return reading.tooltip ? view.tooltip(reading.tooltip) : view;
  }
  const tightest = reading.status === "ok" ? getTightestUsageBucket(reading.buckets) : null;
  if (tightest) {
    return h_flex()
      .gap(5)
      .items_center()
      .child(mark(t, reading.provider, 11))
      .child(
        div()
          .text_color(t.foreground)
          .child(`${tightest.usedPercent}% ${formatBucketChipLabel(tightest)}`),
      );
  }
  return h_flex()
    .gap(3)
    .items_center()
    .text_color(t.muted)
    .child(mark(t, reading.provider, 11))
    .child(svg("mods/orca-assets/triangle-alert.svg").size(9).flex_none().text_color(t.muted))
    .child(div().text_size(11).child(reading.label));
}

export default class OrcaStatus extends View {
  readings: UsageReading[] | null = null;
  gatewayUsage: UsageReading[] = [];
  isRefreshing = false;
  lastRefresh = 0;
  gatewayRefreshing = false;
  wtBusy = false;
  wtCheckouts: Map<string, { at: number; value: Checkout | null }> | undefined;

  init(_props: unknown, cx: Cx): void {
    this.readings = null;
    this.gatewayUsage = [];
    this.refreshGatewayUsage(cx);
    cx.timer.every(15000, (tickCx) => this.refreshGatewayUsage(tickCx));
    this.isRefreshing = false;
    this.lastRefresh = 0;
    this.refreshUsage(cx);
    this.watch(cx);
    this.followIntoWorktree(cx);
    cx.spawn(async (jobCx) => {
      for (;;) {
        if ((await nextCommand()) === "refresh") this.refreshUsage(jobCx, true);
      }
    });
    cx.timer.every(FALLBACK_MS, (tickCx) => this.refreshUsage(tickCx));
  }

  watch(cx: Cx): void {
    for (const dir of WATCHED_DIRS(home())) {
      cx.spawn(async (jobCx) => {
        try {
          for (;;) {
            await watchFolder(dir);
            this.refreshUsage(jobCx);
          }
        } catch {}
      });
    }
  }

  followIntoWorktree(cx: Cx): void {
    if (checking()) return;
    this.wtBusy = false;
    this.wtCheckouts = new Map();
    cx.timer.every(FOLLOW_EVERY_MS, (tickCx) => this.followTick(tickCx));
  }

  async wtCheckout(folder: string): Promise<Checkout | null> {
    const hit = this.wtCheckouts?.get(folder);
    if (hit && Date.now() - hit.at < FOLLOW_TTL_MS) return hit.value;
    let value: Checkout | null = null;
    try {
      const r = await exec("git", [
        "-C",
        folder,
        "rev-parse",
        "--path-format=absolute",
        "--show-toplevel",
        "--git-dir",
        "--git-common-dir",
        "--abbrev-ref",
        "HEAD",
      ]);
      if (r.code === 0) value = parseCheckout(r.stdout);
    } catch {}
    this.wtCheckouts?.set(folder, { at: Date.now(), value });
    return value;
  }

  async agentCwds(agentPanes: AgentPane[]): Promise<Record<string, string | null>> {
    const cwds: Record<string, string | null> = {};
    for (const pane of agentPanes) {
      cwds[pane.terminal] = typeof pane.cwd === "string" && pane.cwd ? pane.cwd : null;
      if (cwds[pane.terminal]) continue;
      try {
        const r = await hc(["get", pane.terminal, "--json"]);
        if (r.code === 0) cwds[pane.terminal] = foregroundCwd(r.stdout);
      } catch {}
    }
    return cwds;
  }

  async knownSpaces<S extends SpaceRef>(
    snapshot: S[],
    checkouts = new Map<string, Checkout | null>(),
  ): Promise<(S & { checkout: Checkout | null })[]> {
    const known: (S & { checkout: Checkout | null })[] = [];
    for (const space of snapshot) {
      if (!space.machine && !checkouts.has(space.folder))
        checkouts.set(space.folder, await this.wtCheckout(space.folder));
      known.push({
        ...space,
        checkout: space.machine ? null : (checkouts.get(space.folder) ?? null),
      });
    }
    return known;
  }

  followTick(cx: Cx): void {
    if (this.wtBusy) return;
    const agentPanes = (panes() ?? []).filter(isAgentPane);
    if (!agentPanes.length) return;
    this.wtBusy = true;
    cx.spawn(async (jobCx) => {
      try {
        const cwds = await this.agentCwds(agentPanes);
        const checkouts = new Map<string, Checkout | null>();
        for (const cwd of new Set(Object.values(cwds).filter(isPresent)))
          checkouts.set(cwd, await this.wtCheckout(cwd));
        const known = await this.knownSpaces(spaces() ?? [], checkouts);
        const move = planFollow({
          spaces: known,
          panes: agentPanes,
          cwds,
          cwdCheckouts: Object.fromEntries(checkouts),
          moved: movedState(),
        });
        if (move) await this.followMove(move, known, jobCx);
      } finally {
        this.wtBusy = false;
      }
    });
  }

  async followMove(move: Move, known: KnownSpace[], cx: Cx): Promise<void> {
    const before = (spaces() ?? []).find((s) => s.active)?.id ?? null;
    const found = await ensureTargetSpace(move, known, cx);
    if (!found) return;
    const tabId = await moveTerminalInto(move, found.target, cx);
    if (!tabId) {
      notify({
        title: `${move.app} lost its pane`,
        body: "It is still running without one; keep it from the Agents list.",
        level: "error",
      });
      return;
    }
    finishMove(move, tabId, found.spareTab, before);
  }

  refreshGatewayUsage(cx: Cx): void {
    if (this.gatewayRefreshing) return;
    this.gatewayRefreshing = true;
    cx.spawn(async (jobCx) => {
      try {
        const root = `${appHome()}/litellm-gateway/events.jsonl`;
        const texts = await Promise.all(
          [root + ".1", root].map((path) => readTextFile(path).catch(() => null)),
        );
        if (texts.every((text) => text === null)) return;
        this.gatewayUsage = gatewayReadings(texts);
      } catch {
      } finally {
        this.gatewayRefreshing = false;
        jobCx.notify();
      }
    });
  }

  refreshUsage(cx: Cx, force = false): void {
    if (this.isRefreshing) return;
    if (!force && Date.now() - this.lastRefresh < MIN_REFRESH_MS) return;
    this.isRefreshing = true;
    this.lastRefresh = Date.now();
    cx.notify();

    cx.spawn(async (jobCx) => {
      try {
        const { providers } = await probeAllProviders({ exec, home: home() });
        const installed = await knownAgents()
          .then((a) => new Set(a.filter((x) => x.installed).map((x) => x.run[0])))
          .catch(() => null);
        this.readings = [...(await probeLocal(exec, installed)), ...providers];
      } catch {
      } finally {
        this.isRefreshing = false;
        jobCx.notify();
      }
    });
  }

  render(): NativeElement {
    const t = statusTheme();
    const readings = this.readings;
    const drawn = [...(readings ?? []), ...(this.gatewayUsage ?? [])]
      .filter(
        (r) =>
          r.text ||
          (r.status === "error" && r.provider !== "antigravity") ||
          (r.status === "ok" && r.buckets.length > 0),
      )
      .sort((a, b) => rank(a.provider) - rank(b.provider));

    return h_flex()
      .w_full()
      .h(20)
      .min_h(20)
      .flex_none()
      .pl(0)
      .pr(10)
      .gap(13)
      .items_center()
      .bg(t.surface)
      .border_t(1)
      .border_color(t.border)
      .text_size(10)
      .text_color(t.foreground)
      .child(this.usageCluster(t, readings, drawn))
      .child(this.maintenanceGroup(t));
  }

  usageCluster(
    t: StatusTheme,
    readings: UsageReading[] | null,
    drawn: UsageReading[],
  ): NativeElement {
    return h_flex()
      .flex_1()
      .min_w(0)
      .items_center()
      .gap(10)
      .child(
        h_flex()
          .gap(10)
          .items_center()
          .px(3)
          .py(2)
          .rounded(3)
          .text_size(9)
          .role("button")
          .cursor_pointer()
          .hover((s) => s.bg("#404040b3"))
          .when(drawn.length > 0 || readings === null, (el) =>
            el.child(div().text_color(t.muted).child("Used")),
          )
          .when(readings === null, (el) =>
            el.children(
              ["antigravity", "omp"].map((p) =>
                h_flex()
                  .gap(5)
                  .items_center()
                  .text_color(t.muted)
                  .child(mark(t, p, 11))
                  .child(div().child("···")),
              ),
            ),
          )
          .children(drawn.map((reading) => chip(t, reading))),
      )
      .child(
        h_flex()
          .px(2.5)
          .py(2)
          .rounded(3)
          .items_center()
          .justify_center()
          .role("button")
          .accessibility_label("Refresh rate limits")
          .tooltip("Refresh usage data")
          .cursor_pointer()
          .hover((s) => s.bg("#404040b3"))
          .on_click((_event, clickCx) => this.refreshUsage(clickCx, true))
          .child(
            svg("mods/orca-assets/refresh-cw.svg")
              .size(9)
              .flex_none()
              .text_color(t.muted)
              .when(this.isRefreshing, (el) => el.spin(SPIN_PERIOD_MS).text_color(t.foreground)),
          ),
      );
  }

  maintenanceGroup(t: StatusTheme): NativeElement {
    const up = updates();
    const openSettings = (section: string) => () => run("app.settings", { section });

    const hosts = (machines() ?? []).filter((m) => m.name !== null);
    const connected = hosts.filter((m) => m.layout === "ready").length;
    const hostsKnown = hosts.length > 0 && !hosts.some((m) => m.layout === "loading");

    return h_flex()
      .gap(10)
      .items_center()
      .when(up.core.updating, (el) =>
        el.child(
          segment(t, "st-core-updating", "refresh-cw", "Updating", {
            spin: true,
            on: openSettings("updates"),
          }),
        ),
      )
      .when(!up.core.updating && Boolean(up.core.error), (el) =>
        el.child(
          segment(t, "st-core-failed", "alert-circle", "1 server update failed", {
            iconColor: t.blocked,
            on: openSettings("updates"),
          }),
        ),
      )
      .when(Boolean(up.app.ready), (el) =>
        el.child(
          segment(t, "st-app-ready", "circle-check", "Update ready", {
            iconColor: t.done,
            on: openSettings("updates"),
          }),
        ),
      )
      .when(hostsKnown, (el) =>
        el.child(
          segment(t, "st-hosts", "server", `${connected} host${connected === 1 ? "" : "s"}`, {
            muted: true,
            on: openSettings("machines"),
          }),
        ),
      )
      .child(floatToggle(t));
  }
}
