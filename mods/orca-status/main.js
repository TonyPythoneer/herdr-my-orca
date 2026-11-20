// Derived from Herdr App's defaults/mods/spaces/main.js (Apache-2.0, Copyright Herdr App authors).
// Modified for herdr-orca; see LICENSE and NOTICE.
// Portions ported from Orca (MIT, Copyright (c) 2026 Lovecast Inc.); see NOTICE.
// Orca's bottom bar (StatusBarSurface.tsx:121,136,308-370): provider usage on the
// left (flex-1), maintenance segments right-aligned with 12px gaps, an invisible
// visibility-menu trigger last.
import { View, div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { machines, updates, theme, run, exec, home, shared, keys, watchFolder, nextCommand } from "herdr";
import { probeLocal } from "./local-usage.js";
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
const resetIn = (iso) => {
  const s = iso ? Math.max(0, Math.round((Date.parse(iso) - Date.now()) / 1000)) : null;
  return s == null ? "" : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h ${Math.floor(s % 3600 / 60)}m` : `${Math.floor(s / 86400)}d ${Math.floor(s % 86400 / 3600)}h`;
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

export default class OrcaStatus extends View {

  init(_props, cx) {
    // Null is "not read yet", distinct from "read, and nothing is signed in".
    this.readings = null;
    this.isRefreshing = false;
    this.lastRefresh = 0;
    this.refreshUsage(cx);
    this.watch(cx);
    // A direct push from the agent's own event: Claude Code's statusLine script writes the
    // live windows and then runs `herdr-app do orca-status.refresh`, which lands here as a
    // command — no file watch, no timer, just the CLI event reaching the mod (run() delivers
    // "<mod>.<command>" to nextCommand(), herdr.d.ts:79).
    cx.spawn(async (cx) => {
      for (;;) {
        if (await nextCommand() === "refresh") this.refreshUsage(cx, true);
      }
    });
    // Orca keeps a 15-minute poll because live statusline posts carry the updates between
    // polls (service.ts DEFAULT_POLL_MS). Here the watches carry them; this timer is the
    // fallback (a folder missing, a watch rejected) and the idle OAuth refresh.
    cx.timer.every(FALLBACK_MS, (cx) => this.refreshUsage(cx));
  }

  watch(cx) {
    for (const dir of WATCHED_DIRS(home())) {
      cx.spawn(async (cx) => {
        try {
          for (;;) {
            await watchFolder(dir);
            this.refreshUsage(cx);
          }
        } catch {
          // No such folder yet (or a tree too large to watch): the timer still reads it.
        }
      });
    }
  }

  refreshUsage(cx, force = false) {
    if (this.isRefreshing) return;
    if (!force && Date.now() - this.lastRefresh < MIN_REFRESH_MS) return;
    this.isRefreshing = true;
    this.lastRefresh = Date.now();
    cx.notify();

    cx.spawn(async (cx) => {
      try {
        const { providers } = await probeAllProviders({ exec, home: home() });
        this.readings = [...await probeLocal(exec), ...providers];
      } catch {
        // Retain prior state on failure
      } finally {
        this.isRefreshing = false;
        cx.notify();
      }
    });
  }

  render(cx) {
    const t = theme();
    const up = updates();
    const openSettings = (section) => () => run("app.settings", { section });

    // Orca's SSH segment hides when no host is configured and otherwise shows the
    // connected count in muted 11px text (SshStatusSegment.tsx:170,177,209-221).
    const hosts = (machines() ?? []).filter(m => m.name !== null);
    const connected = hosts.filter(m => m.layout === "ready").length;
    // machines() stays "loading" until its first read (herdr.d.ts:22323); counting
    // before that would flash "0 hosts" on every start.
    const hostsKnown = hosts.length > 0 && !hosts.some(m => m.layout === "loading");

    // StatusBarSurface.tsx:330-366 — the floating-workspace toggle at the maintenance row's
    // end: a 20px (`size-5`) outlined button around the 14px (`size-3.5`) PanelsTopLeft glyph,
    // with a 6px amber dot (`size-1.5 bg-amber-500 ring-1 ring-secondary`) while the panel is
    // closed with activity the person has not seen (`use-status-bar-controller.ts:216`).
    // Orca reads both flags from its store; Herdr mods share none, so orca-float publishes them
    // and the bar reads them back (AGENTS.md rule 10).
    const floatOpen = shared("orca-float.open") === true;
    const floatAttention = !floatOpen && shared("orca-float.attention") === true;
    const floatLabel = floatOpen ? "Minimize Floating Workspace" : "Show Floating Workspace";
    const floatChord = (keys() ?? []).find(k => k.action === "orca-float.toggle")?.keys ?? "";

    // Orca segment shape: gap-1.5 px-1 py-0.5 rounded, 10px glyph, 9px label,
    // hover:bg-accent/70 (UpdateStatusSegment.tsx:115-122); the label keeps #f0f0f0.
    const segment = (id, iconName, label, opts = {}) => h_flex()
      .id(id).gap(5).px(3).py(2).rounded(3).items_center().text_size(9)
      .text_color(opts.muted ? t.muted : t.foreground)
      .when(Boolean(opts.on), el => el.role("button").accessibility_label(label).tooltip(label)
        .cursor_pointer().hover(s => s.bg("#404040b3").text_color(t.foreground)).on_click(opts.on))
      .child(svg(`mods/orca-status/${iconName}.svg`).size(10).flex_none()
        .text_color(opts.iconColor ?? t.muted)
        .when(Boolean(opts.spin), el => el.spin(1000)))
      .child(label);

    // Orca nests the number and the window inside one chip per provider
    // (StatusBarProviderSegment.tsx:315-339); the provider is the mark, not a word, and the
    // tightest window stands for the whole provider (getTightestUsageSection, UsageRosterPanel.tsx).
    // `readings === null` is the first load, which draws Orca's pending chips
    // (StatusBarProviderSegment.tsx:267-274); an empty array is a finished probe that found
    // nothing signed in, and then the cluster shows only "Used" with no chips at all.
    const readings = this.readings;
    const mark = (provider, size) => {
      const m = MARKS[provider];
      if (m?.image) return image(`mods/orca-status/${m.path}`).w(size).h(size).flex_none().rounded(2);
      if (m) return svg(`mods/orca-status/${m.path}`).size(size).flex_none();
      return div().size(size).flex_none().flex().items_center().justify_center()
        .text_size(9).text_color(t.muted).child(letterFor(provider));
    };
    const chip = (reading) => {
      // Local providers (local-usage.js): a bar for the first window (5h), then every window as
      // "used% reset"; a window that is not 5h or the week (e.g. Fable) is named instead.
      if (reading.detail) {
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
        return h_flex().gap(7).items_center().child(mark(reading.provider, 11))
          .when(Boolean(first), el => el.child(h_flex().w(80).h(5).flex_none().gap(2)
            .children([0, 1, 2, 3, 4].map(i => div().flex_1().h(5).rounded(2).bg(t.raised)
              .child(div().h(5).rounded(2).bg(t.foreground).w(`${Math.min(100, Math.max(0, (first.usedPercent - i * 20) * 5))}%`))))))
          .child(h_flex().gap(5).items_center().text_color(t.foreground)
            .children(parts.flatMap((x, i) => i ? [div().text_color(t.muted).child("·"), part(x)] : [part(x)])));
      }
      const tightest = reading.status === "ok" ? getTightestUsageBucket(reading.buckets) : null;
      if (tightest) {
        const label = formatBucketChipLabel(tightest);
        return h_flex().gap(5).items_center()
          .child(mark(reading.provider, 11))
          .child(div().text_color(t.foreground).child(`${tightest.usedPercent}% ${label}`));
      }
      // Error chip: mark, warning triangle, then the source's own words
      // (StatusBarProviderSegment.tsx:297-305; the copy is usage-error-copy.ts:131).
      return h_flex().gap(3).items_center().text_color(t.muted)
        .child(mark(reading.provider, 11))
        .child(svg("mods/orca-status/triangle-alert.svg").size(9).flex_none().text_color(t.muted))
        .child(div().text_size(11).child(reading.label));
    };
    const drawn = (readings ?? [])
      // Antigravity's error chip is dropped: its CLI (agy) is not installed here.
      .filter(r => r.text || (r.status === "error" && r.provider !== "antigravity") || (r.status === "ok" && r.buckets.length > 0))
      .sort((a, b) => rank(a.provider) - rank(b.provider));

    // StatusBarSurface.tsx:121 — h-6 min-h-[24px] px-3 gap-4 border-t, text-xs,
    // bg-[var(--bg-titlebar,var(--card))] = t.surface (#171717). The maintenance row is now 20pt
    // instead of Orca's 24; every spacing, text and glyph here is scaled by 5/6 (20/24) so the
    // layout compresses without changing the arrangement, keeping the 14/15/16 glyphs at
    // 12/11/10 and the usage bar/percentages at their scaled widths/heights.
    return h_flex().w_full().h(20).min_h(20).flex_none().px(10).gap(13).items_center()
      .bg(t.surface).border_t(1).border_color(t.border).text_size(10).text_color(t.foreground)
      // StatusBarSurface.tsx:136 — left usage cluster: flex min-w-0 flex-1 items-center
      .child(
        h_flex().flex_1().min_w(0).items_center().gap(10)
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
                    .child(mark(p, 11)).child(div().child("···")))))
              .children(drawn.map(chip))
          )
          // StatusBarSurface.tsx:280-298 — Refresh button
          .child(
            h_flex().px(2.5).py(2).rounded(3).items_center().justify_center()
              .role("button").accessibility_label("Refresh rate limits").tooltip("Refresh usage data")
              .cursor_pointer().hover(s => s.bg("#404040b3"))
              .on_click((_e, cx) => this.refreshUsage(cx, true))
              .child(
                svg("mods/orca-status/refresh-cw.svg").size(9).flex_none()
                  .text_color(t.muted)
                  .when(this.isRefreshing, el => el.spin(1000).text_color(t.foreground))
              )
          )
      )
      // StatusBarSurface.tsx:308 — middle maintenance group: flex w-max gap-3
      .child(h_flex().gap(10).items_center()
        // Remote-server update (RemoteServerUpdateStatusSegment.tsx:19-70)
        .when(up.core.updating, el => el.child(segment("st-core-updating", "refresh-cw", "Updating", { spin: true, on: openSettings("updates") })))
        .when(!up.core.updating && Boolean(up.core.error), el => el.child(segment("st-core-failed", "alert-circle", "1 server update failed", { iconColor: t.blocked, on: openSettings("updates") })))
        // App update (UpdateStatusSegment.tsx:70-88)
        .when(Boolean(up.app.ready), el => el.child(segment("st-app-ready", "circle-check", "Update ready", { iconColor: t.done, on: openSettings("updates") })))
        // Remote hosts (SshStatusSegment.tsx:177)
        .when(hostsKnown, el => el.child(segment("st-hosts", "server", `${connected} host${connected === 1 ? "" : "s"}`, { muted: true, on: openSettings("machines") })))
        // StatusBarSurface.tsx:330-366 — `border-border bg-secondary shadow-xs`, hover
        // `bg-accent`; the dot sits `right-0.5 top-0.5` and its ring is the button's fill.
        .child(div().id("st-float").relative().size(17).flex_none().flex().items_center().justify_center().rounded(3)
          .border_1().border_color(t.border).bg(t.raised).text_color(t.foreground)
          .cursor_pointer().hover(s => s.bg(t.hover).text_color(t.foreground))
          .role("button")
          .accessibility_label(floatAttention ? `${floatLabel}, new activity` : floatLabel)
          .tooltip(floatChord ? `${floatLabel} (${floatChord})` : floatLabel)
          .on_click(() => run("orca-float.toggle"))
          .child(svg("mods/orca-status/panels-top-left.svg").size(14).flex_none())
          .when(floatAttention, el => el.child(div().absolute().top(2).right(2).size(5).rounded_full().flex_none()
            .bg("#f59e0b").border_1().border_color(t.raised))))
      );
  }
}
