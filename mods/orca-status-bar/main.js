// Derived from Herdr App's defaults/mods/spaces/main.js (Apache-2.0, Copyright Herdr App authors).
// Modified for herdr-orca; see LICENSE and NOTICE.
// Portions ported from Orca (MIT, Copyright (c) 2026 Lovecast Inc.); see NOTICE.
// Orca's bottom bar (StatusBarSurface.tsx:121,136,308-370): provider usage on the
// left (flex-1), maintenance segments right-aligned with 12px gaps, an invisible
// visibility-menu trigger last.
import { View, div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { machines, updates, theme, run, exec, knownAgents, home, shared, keys, watchFolder, nextCommand, panes, spaces, hc, setShared, checking, notify, appHome, readTextFile } from "herdr";
import { gatewayReadings } from "./gateway-usage.js";
import { probeLocal } from "./local-usage.js";
import { SPIN_PERIOD_MS } from "./ui-settings.js";
import { FOLLOW_EVERY_MS, FOLLOW_STATE_KEY, planFollow, parseCheckout } from "./wt-follow.js";
import { probeAllProviders, getTightestUsageBucket, formatBucketChipLabel } from "./usage.js";

// Every provider the cluster can draw a mark for, keyed by the id its quota source reports.
// A PNG keeps its own colours (`image`); a `currentColor` glyph is a mask (`svg`,
// gpui-kit.d.ts:20273-20281). Rule 9: each mark lives in this folder, so the mod installs alone.
const MARKS = {
  antigravity: { path: "antigravity.png", image: true },
  commandcode: { path: "command-code.svg" },
  "github-copilot": { path: "copilot.svg" },
  claude: { path: "claude.svg" },
  anthropic: { path: "claude.svg" },
  codex: { path: "codex.svg" },
  openai: { path: "codex.svg" },
  opencode: { path: "opencode.svg" },
  cursor: { path: "cursor.png", image: true },
  // The second probe's own mark, for its pending chip: `omp usage` speaks for several
  // providers before any of them has answered.
  omp: { path: "omp.svg", image: true },
};
// Orca's roster order (use-status-bar-controller.ts:219-231). The bar never reorders by
// percentage, unlike the popover roster, so a chip does not move when a reading changes.
const ORDER = [
  "antigravity", "claude", "anthropic", "codex", "openai", "opencode",
  "commandcode", "github-copilot", "cursor"
];
const rank = (provider) => {
  const i = ORDER.indexOf(provider);
  return i === -1 ? ORDER.length : i;
};
// A provider this mod ships no mark for takes Orca's per-provider letter instead of the
// icon (StatusBarProviderSegment.tsx:184-212); ours is the id's first letter, because
// Orca's switch only covers the ten providers it ships drawings for.
// "3h 12m" / "6d 4h" until an ISO time; "" when unknown.
const HOUR_S = 3600;
const DAY_S = 86400;
const resetIn = (iso) => {
  if (!iso) return "";
  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp)) return "";
  const s = Math.max(0, Math.round((timestamp - Date.now()) / 1000));
  if (s < HOUR_S) return `${Math.floor(s / 60)}m`;
  if (s < DAY_S) return `${Math.floor(s / HOUR_S)}h ${Math.floor(s % HOUR_S / 60)}m`;
  return `${Math.floor(s / DAY_S)}d ${Math.floor(s % DAY_S / HOUR_S)}h`;
};
const letterFor = (provider) => (provider.trim()[0] ?? "?").toUpperCase();

// The three sources are files the CLIs write on every turn. A mod cannot hear a process
// directly, but it can wait on the folder that process writes into (herdr.d.ts:411-421), which
// is Herdr's push channel. A missing folder ends that watch and leaves the timer below.
const WATCHED_DIRS = (h) => [
  `${h}/.cache/herdr-usage`,      // Claude's statusLine feed and the OAuth fallback snapshot
  `${h}/.codex/sessions`,         // Codex appends token_count/rate_limits to the newest rollout
  `${h}/.local/share/opencode`,   // opencode's SQLite (and WAL) writes
];
// A stream of session events should not spawn an exec per event; events inside this floor are
// covered by the next event or the timer.
const MIN_REFRESH_MS = 2000;
const FALLBACK_MS = 300000;
// A folder's checkout and branch change rarely; the worktree poll reads them for every space.
const FOLLOW_TTL_MS = 60000;

// `run` returns nothing (herdr.d.ts:91), so every step of a move waits on the app model: poll
// until `ok()` holds, at most `ms`.
const FOLLOW_POLL_MS = 50;
const FOLLOW_WAIT_MS = 4000;
async function till(cx, ok, ms = FOLLOW_WAIT_MS) {
  for (let i = 0; i < ms / FOLLOW_POLL_MS; i++) { if (ok()) return true; await cx.sleep(FOLLOW_POLL_MS); }
  return ok();
}

// The space the tab moves into: the checkout's own when it has one, else a new one. The ids are
// read back from the model: the new space is the one on this folder, and its first tab is the
// shell that came with it. Null when the space never appears.
async function ensureTargetSpace(move, known, cx) {
  const existing = known.find((s) => s.checkout?.top === move.to);
  if (existing) return { target: existing, spareTab: null };
  run("space.new", { folder: move.to, focus: false });
  await till(cx, () => (spaces() ?? []).some((s) => s.folder === move.to));
  const target = (spaces() ?? []).find((s) => s.folder === move.to);
  if (!target) return null;
  return { target, spareTab: (target.tabs ?? [])[0]?.id ?? null };
}

// The tab the terminal landed in inside `target`, or null while it has none there.
function landedTab(move, target) {
  const tab = (panes() ?? []).find((p) => p.terminal === move.terminal)?.tab;
  const space = (spaces() ?? []).find((s) => s.id === target.id);
  return tab && (space?.tabs ?? []).some((t) => t.id === tab) ? tab : null;
}

// Parks the terminal and keeps it in `target`; returns the tab it landed in (null: never did).
async function moveTerminalInto(move, target, cx) {
  const source = (spaces() ?? []).find((s) => s.id === move.from.space);
  // A space closes with its last tab, so a space whose only terminal is this one gets a tab.
  if (move.from.onlyTerminal && source) run("tab.new", { space: source.id, folder: source.folder, focus: false });
  // `terminal.keep` gives the tab to the space that is shown, so show the worktree's first.
  run("space.select", { id: target.id });
  await till(cx, () => (spaces() ?? []).find((s) => s.active)?.id === target.id);
  run("terminal.park", { terminal: move.terminal });
  await till(cx, () => !(panes() ?? []).some((p) => p.terminal === move.terminal));
  run("terminal.keep", { terminal: move.terminal, place: "tab" });
  // The tab must land in the worktree's space before the shell tab is closed, or the close is
  // refused for being the space's only tab.
  const landed = () => landedTab(move, target);
  if (landed()) return landed();
  await till(cx, () => Boolean(landed()));
  return landed();
}

// Orca segment shape: gap-1.5 px-1 py-0.5 rounded, 10px glyph, 9px label,
// hover:bg-accent/70 (UpdateStatusSegment.tsx:115-122); the label keeps #f0f0f0.
function segment(t, id, iconName, label, opts = {}) {
  return h_flex()
    .id(id).gap(5).px(3).py(2).rounded(3).items_center().text_size(9)
    .text_color(opts.muted ? t.muted : t.foreground)
    .when(Boolean(opts.on), el => el.role("button").accessibility_label(label).tooltip(label)
      .cursor_pointer().hover(s => s.bg("#404040b3").text_color(t.foreground)).on_click(opts.on))
    .child(svg(iconName === "refresh-cw" ? "mods/orca-assets/refresh-cw.svg" : sharedAsset(`mods/orca-status-bar/${iconName}.svg`)).size(10).flex_none()
      .text_color(opts.iconColor ?? t.muted)
      .when(Boolean(opts.spin), el => el.spin(SPIN_PERIOD_MS)))
    .child(label);
}

// StatusBarSurface.tsx:330-366 — the floating-workspace toggle at the maintenance row's
// end: a 20px (`size-5`) outlined button around the 14px (`size-3.5`) PanelsTopLeft glyph,
// with a 6px amber dot (`size-1.5 bg-amber-500 ring-1 ring-secondary`) while the panel is
// closed with activity the person has not seen (`use-status-bar-controller.ts:216`).
// Orca reads both flags from its store; Herdr mods share none, so orca-float-workspace publishes them
// and the bar reads them back (AGENTS.md rule 10).
// StatusBarSurface.tsx:330-366 — `border-border bg-secondary shadow-xs`, hover
// `bg-accent`; the dot sits `right-0.5 top-0.5` and its ring is the button's fill.
function floatToggle(t) {
  const floatOpen = shared("orca-float-workspace.open") === true;
  const floatAttention = !floatOpen && shared("orca-float-workspace.attention") === true;
  const floatLabel = floatOpen ? "Minimize Floating Workspace" : "Show Floating Workspace";
  const floatChord = (keys() ?? []).find(k => k.action === "orca-float-workspace.toggle")?.keys ?? "";
  return div().id("st-float").relative().size(17).flex_none().flex().items_center().justify_center().rounded(3)
    .border_1().border_color(t.border).bg(t.raised).text_color(t.foreground)
    .cursor_pointer().hover(s => s.bg(t.hover).text_color(t.foreground))
    .role("button")
    .accessibility_label(floatAttention ? `${floatLabel}, new activity` : floatLabel)
    .tooltip(floatChord ? `${floatLabel} (${floatChord})` : floatLabel)
    .on_click(() => run("orca-float-workspace.toggle"))
    .child(svg("mods/orca-assets/panels-top-left.svg").size(14).flex_none())
    .when(floatAttention, el => el.child(div().absolute().top(2).right(2).size(5).rounded_full().flex_none()
      .bg("#f59e0b").border_1().border_color(t.raised)));
}

// Orca nests the number and the window inside one chip per provider
// (StatusBarProviderSegment.tsx:315-339); the provider is the mark, not a word, and the
// tightest window stands for the whole provider (getTightestUsageSection, UsageRosterPanel.tsx).
function mark(t, provider, size) {
  const m = MARKS[provider];
  if (m?.image) return image(sharedAsset(`mods/orca-status-bar/${m.path}`)).w(size).h(size).flex_none().rounded(2);
  if (m) return svg(sharedAsset(`mods/orca-status-bar/${m.path}`)).size(size).flex_none();
  return div().size(size).flex_none().flex().items_center().justify_center()
    .text_size(9).text_color(t.muted).child(letterFor(provider));
}

// Local providers (local-usage.js): a bar for the first window (5h), then every window as
// "used% reset"; a window that is not 5h or the week (e.g. Fable) is named instead.
function detailChip(t, reading) {
  const first = reading.buckets[0];
  // [pct, rest]: the percentage goes in a badge, the reset (or name) after it.
  const parts = reading.text
    ? [[null, `${reading.text} ${resetIn(reading.resetTime)}`]]
    : reading.buckets.map(b => [`${b.usedPercent}%`, b.idleText ?? (b.label === "5h" || b.label === "wk" ? resetIn(b.resetTime) : b.label)]);
  // The percentage badge keeps the same 1.3 line height at the 20pt scale: a 9px line
  // plus 1px padding is ~14px, so the badge sits inside the 20pt bar with the same
  // breathing room Orca's plain 11px percentage has in its 24pt bar.
  const part = ([pct, rest]) => h_flex().gap(4).items_center()
    .when(pct != null, el => el.child(div().px(5).py(1).line_height(1.3).rounded_full().bg("#ffffff").text_color("#000000").child(pct)))
    .child(div().child(rest));
  return h_flex().gap(7).items_center().child(mark(t, reading.provider, 11))
    .when(Boolean(first), el => el.child(h_flex().w(80).h(5).flex_none().gap(2)
      .children([0, 1, 2, 3, 4].map(i => div().flex_1().h(5).rounded(2).bg(t.raised)
        .child(div().h(5).rounded(2).bg(t.foreground).w(`${Math.min(100, Math.max(0, (first.usedPercent - i * 20) * 5))}%`))))))
    .child(h_flex().gap(5).items_center().text_color(t.foreground)
      .children(parts.flatMap((x, i) => i ? [div().text_color(t.muted).child("·"), part(x)] : [part(x)])));
}

function chip(t, reading) {
  if (reading.detail) {
    const view = detailChip(t, reading);
    return reading.tooltip ? view.tooltip(reading.tooltip) : view;
  }
  const tightest = reading.status === "ok" ? getTightestUsageBucket(reading.buckets) : null;
  if (tightest) {
    const label = formatBucketChipLabel(tightest);
    return h_flex().gap(5).items_center()
      .child(mark(t, reading.provider, 11))
      .child(div().text_color(t.foreground).child(`${tightest.usedPercent}% ${label}`));
  }
  // Error chip: mark, warning triangle, then the source's own words
  // (StatusBarProviderSegment.tsx:297-305; the copy is usage-error-copy.ts:131).
  return h_flex().gap(3).items_center().text_color(t.muted)
    .child(mark(t, reading.provider, 11))
    .child(svg("mods/orca-assets/triangle-alert.svg").size(9).flex_none().text_color(t.muted))
    .child(div().text_size(11).child(reading.label));
}

// The bookkeeping once the tab has landed: name it, drop the spare shell, remember the move.
function finishMove(move, tabId, spareTab, before) {
  run("tab.rename", { id: tabId, name: move.from.tabName || move.app });
  // The space was made for this tab; the shell it came with is not wanted.
  if (spareTab && spareTab !== tabId) run("tab.close", { id: spareTab });
  setShared(FOLLOW_STATE_KEY, { ...(shared(FOLLOW_STATE_KEY) ?? {}), [move.terminal]: move.to });
  // A tab that moves while the person works elsewhere must not take the window with it.
  if (!move.from.active && before) run("space.select", { id: before });
  notify({ title: `${move.app} is in ${move.branch || move.to.split("/").pop()}`, body: `Its tab moved to ${move.to}.`, level: "success" });
}

export default class OrcaStatus extends View {

  init(_props, cx) {
    // Null is "not read yet", distinct from "read, and nothing is signed in".
    this.readings = null;
    this.gatewayUsage = [];
    this.refreshGatewayUsage(cx);
    cx.timer.every(15000, tickCx => this.refreshGatewayUsage(tickCx));
    this.isRefreshing = false;
    this.lastRefresh = 0;
    this.refreshUsage(cx);
    this.watch(cx);
    this.followIntoWorktree(cx);
    // A direct push from the agent's own event: Claude Code's statusLine script writes the
    // live windows and then runs `herdr-app do orca-status-bar.refresh`, which lands here as a
    // command — no file watch, no timer, just the CLI event reaching the mod (run() delivers
    // "<mod>.<command>" to nextCommand(), herdr.d.ts:79).
    cx.spawn(async (jobCx) => {
      for (;;) {
        if (await nextCommand() === "refresh") this.refreshUsage(jobCx, true);
      }
    });
    // Orca keeps a 15-minute poll because live statusline posts carry the updates between
    // polls (service.ts DEFAULT_POLL_MS). Here the watches carry them; this timer is the
    // fallback (a folder missing, a watch rejected) and the idle OAuth refresh.
    cx.timer.every(FALLBACK_MS, (tickCx) => this.refreshUsage(tickCx));
  }

  watch(cx) {
    for (const dir of WATCHED_DIRS(home())) {
      cx.spawn(async (jobCx) => {
        try {
          for (;;) {
            await watchFolder(dir);
            this.refreshUsage(jobCx);
          }
        } catch {
          // No such folder yet (or a tree too large to watch): the timer still reads it.
        }
      });
    }
  }

  // --- A tab follows its agent into a worktree (wt-follow.js) -------------------------------
  // The bottom bar is always mounted, which is what a watcher needs: a mod only runs while a
  // block of it is in the layout. An agent CLI takes its own process into a worktree
  // (`claude --worktree`, `codex --worktree`, a `cd` inside the CLI) while Herdr keeps the tab
  // in the space it was started in. This puts the tab under the worktree's branch, with
  // `terminal.park` → `terminal.keep`, so the agent itself keeps running.
  followIntoWorktree(cx) {
    if (checking()) return;
    this.wtBusy = false;
    this.wtCheckouts = new Map(); // folder -> { at, value }
    cx.timer.every(FOLLOW_EVERY_MS, (tickCx) => this.followTick(tickCx));
  }

  // `git -C <folder> rev-parse ...` as one record, cached for a minute. Null when not a repo.
  async wtCheckout(folder) {
    const hit = this.wtCheckouts?.get(folder);
    if (hit && Date.now() - hit.at < FOLLOW_TTL_MS) return hit.value;
    let value = null;
    try {
      const r = await exec("git", ["-C", folder, "rev-parse", "--path-format=absolute", "--show-toplevel", "--git-dir", "--git-common-dir", "--abbrev-ref", "HEAD"]);
      if (r.code === 0) value = parseCheckout(r.stdout);
    } catch {
      // git is missing or the folder is gone: it reads as "not a repo", cached like any other answer.
    }
    this.wtCheckouts?.set(folder, { at: Date.now(), value });
    return value;
  }

  // Where each agent's own process is now: `foreground.cwd`, not the pane's `cwd` — the
  // pane's is the shell's folder, which does not move when the program chdirs.
  async agentCwds(agentPanes) {
    const cwds = {};
    for (const pane of agentPanes) {
      // panes() exposes the live terminal folder; only query the core when it is unknown.
      cwds[pane.terminal] = typeof pane.cwd === "string" && pane.cwd ? pane.cwd : null;
      if (cwds[pane.terminal]) continue;
      try {
        const r = await hc(["get", pane.terminal, "--json"]);
        if (r.code === 0) cwds[pane.terminal] = JSON.parse(r.stdout)?.foreground?.cwd ?? null;
      } catch {
        // The terminal went away or printed no JSON: its folder stays unknown and it is skipped.
      }
    }
    return cwds;
  }

  async knownSpaces(snapshot = spaces() ?? [], checkouts = new Map()) {
    const known = [];
    for (const space of snapshot) {
      if (!space.machine && !checkouts.has(space.folder)) checkouts.set(space.folder, await this.wtCheckout(space.folder));
      known.push({ ...space, checkout: space.machine ? null : checkouts.get(space.folder) });
    }
    return known;
  }

  followTick(cx) {
    if (this.wtBusy) return;
    const agentPanes = (panes() ?? []).filter((p) => p.terminal && p.program?.agent);
    if (!agentPanes.length) return;
    this.wtBusy = true;
    cx.spawn(async (jobCx) => {
      try {
        const cwds = await this.agentCwds(agentPanes);
        const checkouts = new Map();
        for (const cwd of new Set(Object.values(cwds).filter(Boolean))) checkouts.set(cwd, await this.wtCheckout(cwd));
        const known = await this.knownSpaces(spaces() ?? [], checkouts);
        const cwdCheckouts = Object.fromEntries(checkouts);
        const move = planFollow({ spaces: known, panes: agentPanes, cwds, cwdCheckouts, moved: shared(FOLLOW_STATE_KEY) ?? {} });
        if (move) await this.followMove(move, known, jobCx);
      } finally {
        this.wtBusy = false;
      }
    });
  }

  async followMove(move, known, cx) {
    const before = (spaces() ?? []).find((s) => s.active)?.id ?? null;
    const found = await ensureTargetSpace(move, known, cx);
    if (!found) return;
    const { target, spareTab } = found;
    const tabId = await moveTerminalInto(move, target, cx);
    if (!tabId) {
      notify({ title: `${move.app} lost its pane`, body: "It is still running without one; keep it from the Agents list.", level: "error" });
      return;
    }
    finishMove(move, tabId, spareTab, before);
  }

  refreshGatewayUsage(cx) {
    if (this.gatewayRefreshing) return;
    this.gatewayRefreshing = true;
    cx.spawn(async jobCx => {
      try {
        const root = `${appHome()}/litellm-gateway/events.jsonl`;
        const texts = await Promise.all([root + ".1", root].map(path => readTextFile(path).catch(() => null)));
        this.gatewayUsage = gatewayReadings(texts);
      } catch { /* keep previous observation on read failure */ }
      finally { this.gatewayRefreshing = false; jobCx.notify(); }
    });
  }

  refreshUsage(cx, force = false) {
    if (this.isRefreshing) return;
    if (!force && Date.now() - this.lastRefresh < MIN_REFRESH_MS) return;
    this.isRefreshing = true;
    this.lastRefresh = Date.now();
    cx.notify();

    cx.spawn(async (jobCx) => {
      try {
        const { providers } = await probeAllProviders({ exec, home: home() });
        // Only agents the create menu lists as installed get a chip; a failed check hides none.
        const installed = await knownAgents().then((a) => new Set(a.filter((x) => x.installed).map((x) => x.run[0]))).catch(() => null);
        this.readings = [...await probeLocal(exec, installed), ...providers];
      } catch {
        // Retain prior state on failure
      } finally {
        this.isRefreshing = false;
        jobCx.notify();
      }
    });
  }

  render() {
    const t = theme();
    // `readings === null` is the first load, which draws Orca's pending chips
    // (StatusBarProviderSegment.tsx:267-274); an empty array is a finished probe that found
    // nothing signed in, and then the cluster shows only "Used" with no chips at all.
    const readings = this.readings;
    const drawn = [...(readings ?? []), ...(this.gatewayUsage ?? [])]
      // Antigravity's error chip is dropped: its CLI (agy) is not installed here.
      .filter(r => r.text || (r.status === "error" && r.provider !== "antigravity") || (r.status === "ok" && r.buckets.length > 0))
      .sort((a, b) => rank(a.provider) - rank(b.provider));

    // StatusBarSurface.tsx:121 — h-6 min-h-[24px] px-3 gap-4 border-t, text-xs,
    // bg-[var(--bg-titlebar,var(--card))] = t.surface (#171717). The maintenance row is now 20pt
    // instead of Orca's 24; every spacing, text and glyph here is scaled by 5/6 (20/24) so the
    // layout compresses without changing the arrangement, keeping the 14/15/16 glyphs at
    // 12/11/10 and the usage bar/percentages at their scaled widths/heights.
    // No left inset: the footer's divider sits flush against this bar, like the gap after the ? button.
    return h_flex().w_full().h(20).min_h(20).flex_none().pl(0).pr(10).gap(13).items_center()
      .bg(t.surface).border_t(1).border_color(t.border).text_size(10).text_color(t.foreground)
      // StatusBarSurface.tsx:136 — left usage cluster: flex min-w-0 flex-1 items-center
      .child(this.usageCluster(t, readings, drawn))
      // StatusBarSurface.tsx:308 — middle maintenance group: flex w-max gap-3
      .child(this.maintenanceGroup(t));
  }

  usageCluster(t, readings, drawn) {
    return h_flex().flex_1().min_w(0).items_center().gap(10)
      .child(
        h_flex().gap(10).items_center().px(3).py(2).rounded(3).text_size(9)
          .role("button").cursor_pointer().hover(s => s.bg("#404040b3"))
          // usage-unit-label.tsx:32-50: "Used" in muted text; it is absent when no chip
          // shows a percentage (getUsageUnitLabelState), which here means no reading at all.
          .when(drawn.length > 0 || readings === null, el =>
            el.child(div().text_color(t.muted).child("Used")))
          // Pending initial loading state: mark + ··· (StatusBarProviderSegment.tsx:267-274).
          // The two sources this mod reads, before either has answered.
          .when(readings === null, el =>
            el.children(["antigravity", "omp"].map(p =>
              h_flex().gap(5).items_center().text_color(t.muted)
                .child(mark(t, p, 11)).child(div().child("···")))))
          .children(drawn.map(reading => chip(t, reading)))
      )
      // StatusBarSurface.tsx:280-298 — Refresh button
      .child(
        h_flex().px(2.5).py(2).rounded(3).items_center().justify_center()
          .role("button").accessibility_label("Refresh rate limits").tooltip("Refresh usage data")
          .cursor_pointer().hover(s => s.bg("#404040b3"))
          .on_click((_e, clickCx) => this.refreshUsage(clickCx, true))
          .child(
            svg("mods/orca-assets/refresh-cw.svg").size(9).flex_none()
              .text_color(t.muted)
              .when(this.isRefreshing, el => el.spin(SPIN_PERIOD_MS).text_color(t.foreground))
          )
      );
  }

  maintenanceGroup(t) {
    const up = updates();
    const openSettings = (section) => () => run("app.settings", { section });

    // Orca's SSH segment hides when no host is configured and otherwise shows the
    // connected count in muted 11px text (SshStatusSegment.tsx:170,177,209-221).
    const hosts = (machines() ?? []).filter(m => m.name !== null);
    const connected = hosts.filter(m => m.layout === "ready").length;
    // machines() stays "loading" until its first read (herdr.d.ts:22323); counting
    // before that would flash "0 hosts" on every start.
    const hostsKnown = hosts.length > 0 && !hosts.some(m => m.layout === "loading");

    return h_flex().gap(10).items_center()
      // Remote-server update (RemoteServerUpdateStatusSegment.tsx:19-70)
      .when(up.core.updating, el => el.child(segment(t, "st-core-updating", "refresh-cw", "Updating", { spin: true, on: openSettings("updates") })))
      .when(!up.core.updating && Boolean(up.core.error), el => el.child(segment(t, "st-core-failed", "alert-circle", "1 server update failed", { iconColor: t.blocked, on: openSettings("updates") })))
      // App update (UpdateStatusSegment.tsx:70-88)
      .when(Boolean(up.app.ready), el => el.child(segment(t, "st-app-ready", "circle-check", "Update ready", { iconColor: t.done, on: openSettings("updates") })))
      // Remote hosts (SshStatusSegment.tsx:177)
      .when(hostsKnown, el => el.child(segment(t, "st-hosts", "server", `${connected} host${connected === 1 ? "" : "s"}`, { muted: true, on: openSettings("machines") })))
      .child(floatToggle(t));
  }
}

const SHARED_ASSET_PATHS = Object.freeze({
  "mods/orca-status-bar/codex.svg": "mods/orca-assets/codex--orca-status-bar.svg"
});
function sharedAsset(path) {
  return SHARED_ASSET_PATHS[path] ?? `mods/orca-assets/${path.slice(path.lastIndexOf("/") + 1)}`;
}
