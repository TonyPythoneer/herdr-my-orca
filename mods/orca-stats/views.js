// The five CodeBurn pages. Each takes the page (`owner`), the theme and the
// data the runner last produced; clicks call back into the page's methods.
import { div, svg } from "gpui-kit";
import { h_flex, v_flex, Input } from "gpui-base";
import {
  activityRows,
  dateTimeLabel,
  dayLabel,
  filterSessions,
  formatDuration,
  healthTone,
  modelRows,
  money,
  monthProjection,
  percent,
  projectRows,
  providerColor,
  providerTotals,
  quotaRows,
  recentSessions,
  relativeTime,
  resetIn,
  sessionTitle,
  severityTone,
  sharePct,
  shortText,
  sortedSessions,
  sumTokens,
  todayStatus,
  tokens,
  worstWindow,
} from "./data.js";
import {
  barRow,
  brandMark,
  button,
  card,
  dailyChart,
  dot,
  emptyNote,
  icon,
  iconButton,
  miniStat,
  mono,
  panelHead,
  pill,
  progress,
  rowsSkeleton,
  skeleton,
  skeletonCard,
} from "./parts.js";

const CHART_ROW = 880;

function twoColumns(left, right, owner) {
  return owner.width >= CHART_ROW
    ? h_flex()
        .w_full()
        .items_start()
        .gap(12)
        .child(div().flex_grow(3).flex_basis(0).min_w(0).child(left))
        .child(div().flex_grow(2).flex_basis(0).min_w(0).child(right))
    : v_flex().w_full().gap(12).child(left).child(right);
}

function metricGrid(items, owner) {
  if (owner.width >= 860) {
    return h_flex()
      .w_full()
      .items_start()
      .gap(12)
      .children(items.map((el) => div().flex_1().min_w(0).child(el)));
  }
  if (owner.width >= 520) {
    const rows = [];
    for (let i = 0; i < items.length; i += 2) {
      rows.push(
        h_flex()
          .w_full()
          .items_start()
          .gap(12)
          .child(div().flex_1().min_w(0).child(items[i]))
          .when(items[i + 1], (el) => el.child(div().flex_1().min_w(0).child(items[i + 1]))),
      );
    }
    return v_flex().w_full().gap(12).children(rows);
  }
  return v_flex().w_full().gap(12).children(items);
}

function sessionProvider(provider) {
  return provider ? provider.charAt(0).toUpperCase() + provider.slice(1) : "Unknown";
}

function planTone(window) {
  if (!window) return "done";
  if (window.usedPct >= 90) return "blocked";
  if (window.usedPct >= 70) return "working";
  return "done";
}

function planToneColor(window, t) {
  const tone = planTone(window);
  return tone === "blocked" ? t.blocked : tone === "working" ? t.working : t.done;
}

function planWindows(provider, t) {
  if (!provider.windows.length) return emptyNote("This plan does not report a usage window.", t, { p: 10 });
  return v_flex()
    .w_full()
    .gap(9)
    .children(
      provider.windows.map((window) =>
        v_flex()
          .w_full()
          .gap(4)
          .child(
            h_flex()
              .w_full()
              .items_center()
              .gap(8)
              .child(div().text_size(11).font_medium().text_color(t.foreground).child(window.label))
              .child(div().flex_1())
              .child(
                div()
                  .text_size(10)
                  .font_medium()
                  .text_color(planToneColor(window, t))
                  .child(`${percent(window.usedPct, 0)} used`),
              )
              .when(window.reset, (el) => el.child(div().text_size(10).text_color(t.dim).child(`· resets ${window.reset}`))),
          )
          .child(progress(window.usedPct, planToneColor(window, t), t, { height: 5 })),
      ),
    );
}

export function planSummaryCard(owner, t, data) {
  const plans = quotaRows(data.quota).available;
  return card(
    [
      panelHead("Plan limits", t, {
        right: plans.length
          ? button("cb-overview-plans", "All plans", t, (_e, cx) => owner.openTab("plans", cx), {
              height: 24,
              px: 8,
              color: t.muted,
              size: 10,
            })
          : null,
      }),
      plans.length
        ? v_flex()
            .w_full()
            .gap(14)
            .children(
              plans.map((provider) =>
                v_flex()
                  .w_full()
                  .gap(7)
                  .child(
                    h_flex()
                      .w_full()
                      .items_center()
                      .gap(7)
                      .child(dot(providerColor(provider.id, t.ansi4), 8))
                      .child(div().text_size(12).font_medium().text_color(t.foreground).child(provider.name))
                      .when(provider.plan, (el) => el.child(pill(provider.plan, t, { size: 9, height: 17, color: t.muted })))
                      .child(div().flex_1())
                      .when(provider.notes?.length, (el) =>
                        el.child(
                          div()
                            .text_size(9)
                            .text_color(planToneColor(worstWindow(provider), t))
                            .child(provider.notes[0]),
                        ),
                      ),
                  )
                  .child(planWindows(provider, t)),
              ),
            )
        : emptyNote(
            data.quota
              ? "No subscription limits to show. Sign in to Claude Code, Codex or another metered plan."
              : "Limits are still loading. They come from the CLIs you are signed in to.",
            t,
            { p: 14 },
          ),
    ],
    t,
    { p: 16, gap: 14 },
  );
}

export function overviewView(owner, t, data) {
  const report = data.report;
  const series = report ? owner.series(report) : null;
  const providers = providerTotals(data.models);
  const models = report ? modelRows(report, data.models).slice(0, 5) : [];
  const projects = report ? projectRows(report, 5) : [];
  const activities = report ? activityRows(report, 5) : [];
  const recent = report ? recentSessions(report, 6) : [];
  const status = todayStatus(data.status);
  const overview = report?.overview;
  const totalTokens = overview
    ? (overview.tokens?.input ?? 0) +
      (overview.tokens?.output ?? 0) +
      (overview.tokens?.cacheRead ?? 0) +
      (overview.tokens?.cacheWrite ?? 0)
    : 0;
  const period = owner.periodLabel();

  if (!report) {
    return v_flex()
      .w_full()
      .gap(12)
      .child(
        metricGrid(
          [
            skeletonCard(t, 3),
            skeletonCard(t, 3),
            skeletonCard(t, 3),
            skeletonCard(t, 3),
          ],
          owner,
        ),
      )
      .child(
        twoColumns(
          card([skeleton(t, { width: "35%", height: 14 }), skeleton(t, { height: 148 })], t, { p: 16 }),
          card([skeleton(t, { width: "45%", height: 14 }), ...Array.from({ length: 4 }, () => skeleton(t, { height: 24 }))], t, { p: 16 }),
          owner,
        ),
      )
      .child(
        twoColumns(
          card([skeleton(t, { width: "40%", height: 14 }), rowsSkeleton(t, 5)], t, { p: 16 }),
          card([skeleton(t, { width: "40%", height: 14 }), rowsSkeleton(t, 5)], t, { p: 16 }),
          owner,
        ),
      );
  }

  const empty = overview.cost <= 0 && series?.total <= 0;
  const metrics = [
    card(
      [
        h_flex()
          .w_full()
          .items_center()
          .gap(6)
          .child(div().text_size(10).font_semibold().text_color(t.dim).child(`SPEND · ${period.toUpperCase()}`))
          .child(div().flex_1())
          .child(icon("bar-chart", 12, t.dim)),
        div().w_full().text_size(27).font_semibold().text_color(t.foreground).child(money(overview.cost)),
        div()
          .w_full()
          .text_size(11)
          .text_color(t.muted)
          .child(`${overview.sessions.toLocaleString("en-US")} sessions · ${overview.calls.toLocaleString("en-US")} calls`),
      ],
      t,
      { p: 14, gap: 7 },
    ),
    card(
      [
        h_flex()
          .w_full()
          .items_center()
          .gap(6)
          .child(div().text_size(10).font_semibold().text_color(t.dim).child("TODAY"))
          .child(div().flex_1())
          .child(icon("clock", 12, t.dim)),
        div().w_full().text_size(27).font_semibold().text_color(t.foreground).child(money(status.today)),
        div()
          .w_full()
          .text_size(11)
          .text_color(t.muted)
          .child(`${status.todayCalls.toLocaleString("en-US")} calls · ${percent(overview.cacheHitPercent, 0)} cache hit`),
      ],
      t,
      { p: 14, gap: 7 },
    ),
    card(
      [
        h_flex()
          .w_full()
          .items_center()
          .gap(6)
          .child(
            div()
              .text_size(10)
              .font_semibold()
              .text_color(t.dim)
              .child(owner.period === "month" || owner.period === "all" ? "PROJECTED MONTH" : "THIS MONTH"),
          )
          .child(div().flex_1())
          .child(icon("layers", 12, t.dim)),
        div()
          .w_full()
          .text_size(27)
          .font_semibold()
          .text_color(t.foreground)
          .child(owner.period === "month" || owner.period === "all" ? money(monthProjection(status.month)) : money(status.month)),
        div()
          .w_full()
          .text_size(11)
          .text_color(t.muted)
          .child(
            owner.period === "month" || owner.period === "all"
              ? "at this pace, from this month's run rate"
              : `projected ${money(monthProjection(status.month))} at this pace`,
          ),
      ],
      t,
      { p: 14, gap: 7 },
    ),
    card(
      [
        h_flex()
          .w_full()
          .items_center()
          .gap(6)
          .child(div().text_size(10).font_semibold().text_color(t.dim).child("TOKENS"))
          .child(div().flex_1())
          .child(icon("sparkles", 12, t.dim)),
        div().w_full().text_size(23).font_semibold().text_color(t.foreground).child(tokens(totalTokens)),
        div()
          .w_full()
          .text_size(11)
          .text_color(t.muted)
          .child(`${tokens(overview.tokens?.input)} in · ${tokens(overview.tokens?.output)} out · ${tokens(overview.tokens?.cacheRead)} cached`),
      ],
      t,
      { p: 14, gap: 7 },
    ),
  ];

  const dailyCard = card(
    [
      h_flex()
        .w_full()
        .items_center()
        .gap(8)
        .child(div().text_size(13).font_semibold().text_color(t.foreground).child("Daily spend"))
        .child(pill(series?.label ?? period, t, { size: 9, height: 18, color: t.muted }))
        .child(div().flex_1())
        .when(series && series.max > 0, (el) =>
          el.child(
            h_flex()
              .gap(12)
              .child(
                h_flex()
                  .gap(5)
                  .items_center()
                  .child(div().text_size(10).text_color(t.dim).child("max"))
                  .child(div().text_size(11).font_medium().text_color(t.muted).child(money(series.max))),
              )
              .child(
                h_flex()
                  .gap(5)
                  .items_center()
                  .child(div().text_size(10).text_color(t.dim).child("avg"))
                  .child(div().text_size(11).font_medium().text_color(t.muted).child(money(series.average))),
              ),
          ),
        ),
      series ? dailyChart(series, t, { height: owner.width < 520 ? 112 : 148 }) : null,
      h_flex()
        .w_full()
        .items_center()
        .gap(10)
        .child(div().text_size(10).text_color(t.dim).child("Bars are API-rate spend per day; the dashed line is the period average."))
        .child(div().flex_1())
        .when(series?.truncated, (el) => el.child(pill("Showing the latest 30 days", t, { size: 9, height: 17 }))),
    ].filter(Boolean),
    t,
    { p: 16, gap: 12 },
  );

  const providerCard = card(
    [
      panelHead("By provider", t, {
        badge: providers.length ? `${providers.length}` : null,
        right: button("cb-overview-models", "Models", t, (_e, cx) => owner.openTab("models", cx), {
          height: 24,
          px: 8,
          color: t.muted,
          size: 10,
        }),
      }),
      providers.length
        ? v_flex()
            .w_full()
            .gap(11)
            .children(
              providers.map((provider) =>
                barRow(
                  {
                    name: provider.name,
                    cost: provider.cost,
                    color: providerColor(provider.id, t.ansi4),
                    note: `${provider.calls.toLocaleString("en-US")} calls`,
                  },
                  t,
                  { total: overview.cost, bar: true },
                ),
              ),
            )
        : emptyNote("No provider breakdown in this period.", t, { p: 12 }),
    ],
    t,
    { p: 16, gap: 13 },
  );

  const modelsCard = card(
    [
      panelHead("Top models", t, {
        right: button("cb-overview-models-2", "All models", t, (_e, cx) => owner.openTab("models", cx), {
          height: 24,
          px: 8,
          color: t.muted,
          size: 10,
        }),
      }),
      models.length
        ? v_flex()
            .w_full()
            .gap(11)
            .children(
              models.map((model) =>
                barRow(
                  {
                    name: model.name,
                    cost: model.cost,
                    color: providerColor(String(model.provider).toLowerCase(), t.ansi5),
                    note: `${model.calls.toLocaleString("en-US")} calls`,
                  },
                  t,
                  { total: overview.cost, bar: true },
                ),
              ),
            )
        : emptyNote("No model spend in this period.", t, { p: 12 }),
    ],
    t,
    { p: 16, gap: 13 },
  );

  const projectsCard = card(
    [
      panelHead("Projects", t, {
        badge: projects.length ? `${projects.length}` : null,
      }),
      projects.length
        ? v_flex()
            .w_full()
            .gap(11)
            .children(
              projects.map((project, index) =>
                barRow(
                  {
                    name: project.name,
                    cost: project.cost,
                    color: [t.ansi4, t.ansi5, t.ansi6, t.ansi3, t.ansi2][index % 5],
                    note: `${project.sessions.toLocaleString("en-US")} sessions`,
                  },
                  t,
                  { total: overview.cost, bar: true },
                ),
              ),
            )
        : emptyNote("No project spend in this period.", t, { p: 12 }),
    ],
    t,
    { p: 16, gap: 13 },
  );

  const activityCard = card(
    [
      panelHead("Where work goes", t, {
        right: div().text_size(10).text_color(t.dim).child("task mix"),
      }),
      activities.length
        ? v_flex()
            .w_full()
            .gap(11)
            .children(
              activities.map((activity) =>
                barRow(
                  {
                    name: activity.name,
                    cost: activity.cost,
                    color: requireCategory(activity.raw, t),
                    note: `${activity.turns.toLocaleString("en-US")} turns`,
                  },
                  t,
                  { total: overview.cost, bar: true },
                ),
              ),
            )
        : emptyNote("No task classification in this period.", t, { p: 12 }),
    ],
    t,
    { p: 16, gap: 13 },
  );

  const recentCard = card(
    [
      panelHead("Top sessions", t, {
        right: button("cb-overview-sessions", "All sessions", t, (_e, cx) => owner.openTab("sessions", cx), {
          height: 24,
          px: 8,
          color: t.muted,
          size: 10,
        }),
      }),
      recent.length
        ? v_flex()
            .w_full()
            .gap(1)
            .children(
              recent.map((session) =>
                h_flex()
                  .id(`cb-recent-${session.sessionId}`)
                  .w_full()
                  .items_center()
                  .gap(10)
                  .py(8)
                  .px(6)
                  .rounded(6)
                  .cursor_pointer()
                  .hover((s) => s.bg(t.hover))
                  .on_click((_e, cx) => owner.openSession(session.sessionId, cx))
                  .child(dot(providerColor(session.provider, t.ansi4), 8))
                  .child(
                    v_flex()
                      .flex_1()
                      .min_w(0)
                      .gap(2)
                      .child(div().min_w(0).truncate().text_size(12).font_medium().text_color(t.foreground).child(session.project))
                      .child(
                        div()
                          .text_size(10)
                          .text_color(t.dim)
                          .child(`${sessionProvider(session.provider)} · ${session.date ? dayLabel(session.date) : "unknown date"} · ${session.calls} calls`),
                      ),
                  )
                  .child(div().flex_none().text_size(12).font_medium().text_color(t.foreground).child(money(session.cost)))
                  .child(icon("chevron-right", 13, t.dim)),
              ),
            )
        : emptyNote("No sessions in this period.", t, { p: 12 }),
    ],
    t,
    { p: 16, gap: 8 },
  );

  return v_flex()
    .w_full()
    .gap(12)
    .when(empty, (el) =>
      el.child(
        card(
          [
            h_flex()
              .w_full()
              .items_center()
              .gap(12)
              .child(brandMark(38))
              .child(
                v_flex()
                  .flex_1()
                  .min_w(0)
                  .gap(3)
                  .child(div().text_size(14).font_semibold().text_color(t.foreground).child("No spend in this period"))
                  .child(
                    div()
                      .text_size(11)
                      .text_color(t.muted)
                      .child("CodeBurn found sessions but none landed in this window. Try 30 days or All time, or start an agent."),
                  ),
              ),
          ],
          t,
          { p: 16 },
        ),
      ),
    )
    .child(metricGrid(metrics, owner))
    .child(twoColumns(dailyCard, planSummaryCard(owner, t, data), owner))
    .child(twoColumns(providerCard, modelsCard, owner))
    .child(twoColumns(projectsCard, activityCard, owner))
    .child(recentCard);
}

// Kept tiny so the data module stays theme-free.
function requireCategory(raw, t) {
  const palette = {
    coding: t.ansi3,
    feature: t.ansi3,
    debugging: t.ansi1,
    testing: t.ansi2,
    exploration: t.ansi4,
    delegation: t.ansi5,
    conversation: t.ansi6,
    git: t.ansi3,
    refactoring: t.ansi6,
    general: t.muted,
    brainstorming: t.ansi5,
  };
  return palette[String(raw ?? "").toLowerCase()] ?? t.ansi4;
}

export function sessionsView(owner, t, data) {
  const query = owner.search.value();
  const all = sortedSessions(data.sessions ?? []);
  const filtered = filterSessions(all, query);
  const shown = filtered.slice(0, owner.sessionLimit);
  const total = filtered.reduce((sum, session) => sum + (Number(session.cost) || 0), 0);
  const narrow = owner.width < 760;
  const tiny = owner.width < 540;

  const searchBox = h_flex()
    .id("cb-search-box")
    .h(32)
    .w(owner.width < 520 ? "100%" : 280)
    .flex_none()
    .items_center()
    .gap(7)
    .px(9)
    .rounded(8)
    .border_1()
    .border_color(t.input)
    .bg(t.background)
    .child(icon("search", 13, t.dim))
    .child(
      Input.new(owner.search)
        .w_full()
        .font_family(mono())
        .text_size(11)
        .text_color(t.foreground)
        .bg("#00000000"),
    )
    .when(Boolean(query), (el) =>
      el.child(
        iconButton("cb-search-clear", "x", "Clear search", t, () => {
          owner.search.set_value("");
          owner.sessionLimit = 50;
        }, { size: 20, borderColor: "#00000000", iconSize: 12 }),
      ),
    );

  const header = h_flex()
    .w_full()
    .items_center()
    .gap(12)
    .flex_wrap()
    .child(searchBox)
    .child(div().flex_1())
    .child(
      h_flex()
        .gap(12)
        .items_center()
        .child(
          h_flex()
            .gap(5)
            .items_center()
            .child(div().text_size(10).text_color(t.dim).child("sessions"))
            .child(div().text_size(12).font_medium().text_color(t.foreground).child(`${filtered.length.toLocaleString("en-US")}`)),
        )
        .child(
          h_flex()
            .gap(5)
            .items_center()
            .child(div().text_size(10).text_color(t.dim).child("cost"))
            .child(div().text_size(12).font_medium().text_color(t.foreground).child(money(total))),
        ),
    );

  const tableHeader = h_flex()
    .w_full()
    .items_center()
    .gap(10)
    .px(10)
    .py(6)
    .border_b(1)
    .border_color(t.border)
    .text_size(9)
    .font_semibold()
    .text_color(t.dim)
    .child(div().flex_1().min_w(0).child("SESSION"))
    .when(!tiny, (el) => el.child(div().w(150).child("PROJECT")))
    .child(div().w(64).child("AGENT"))
    .when(!narrow, (el) => el.child(div().w(58).text_size(9).text_right().child("CALLS")))
    .when(!narrow, (el) => el.child(div().w(66).text_right().child("TOKENS")))
    .child(div().w(76).text_right().child("COST"))
    .when(!tiny, (el) => el.child(div().w(84).text_right().child("WHEN")))
    .child(div().w(16));

  const row = (session) => {
    const open = owner.expanded.has(session.sessionId);
    return v_flex()
      .w_full()
      .flex_none()
      .border_b(1)
      .border_color(t.border)
      .child(
        h_flex()
          .id(`cb-session-${session.sessionId}`)
          .w_full()
          .items_center()
          .gap(10)
          .px(10)
          .py(8)
          .cursor_pointer()
          .hover((s) => s.bg(t.hover))
          .on_click((_e, cx) => owner.toggleSession(session.sessionId, cx))
          .child(
            h_flex()
              .flex_1()
              .min_w(0)
              .items_center()
              .gap(8)
              .child(dot(providerColor(session.provider, t.ansi4), 7))
              .child(
                div()
                  .min_w(0)
                  .truncate()
                  .text_size(12)
                  .font_medium()
                  .text_color(t.foreground)
                  .child(sessionTitle(session)),
              )
              .when(session.isEstimated, (el) =>
                el.child(pill("est", t, { size: 8, height: 15, color: t.working })),
              ),
          )
          .when(!tiny, (el) =>
            el.child(
              div()
                .w(150)
                .truncate()
                .text_size(10)
                .text_color(t.muted)
                .child(projectLabelOf(session.project)),
            ),
          )
          .child(
            div()
              .w(64)
              .truncate()
              .text_size(10)
              .text_color(t.muted)
              .child(sessionProvider(session.provider)),
          )
          .when(!narrow, (el) =>
            el.child(
              div()
                .w(58)
                .text_right()
                .text_size(10)
                .text_color(t.muted)
                .child(String(session.calls ?? "—")),
            ),
          )
          .when(!narrow, (el) =>
            el.child(
              div()
                .w(66)
                .text_right()
                .text_size(10)
                .text_color(t.muted)
                .child(tokens(sumTokens(session))),
            ),
          )
          .child(div().w(76).text_right().text_size(12).font_medium().text_color(t.foreground).child(money(session.cost)))
          .when(!tiny, (el) =>
            el.child(
              div()
                .w(84)
                .text_right()
                .text_size(10)
                .text_color(t.dim)
                .child(relativeTime(session.endedAt ? Date.parse(session.endedAt) : Date.parse(session.startedAt ?? ""))),
            ),
          )
          .child(icon(open ? "chevron-down" : "chevron-right", 13, t.dim)),
      )
      .when(open, (el) => el.child(sessionDetail(owner, t, session)));
  };

  return v_flex()
    .w_full()
    .gap(12)
    .child(header)
    .child(
      card(
        [
          tableHeader,
          all.length === 0
            ? emptyNote("No sessions in this period.", t, { p: 16 })
            : filtered.length === 0
              ? emptyNote(`No sessions match “${query}”.`, t, { p: 16 })
              : v_flex()
                  .w_full()
                  .children(shown.map(row))
                  .when(filtered.length > shown.length, (el) =>
                    el.child(
                      h_flex()
                        .w_full()
                        .justify_center()
                        .pt(8)
                        .child(
                          button(
                            "cb-more-sessions",
                            `Show ${Math.min(50, filtered.length - shown.length)} more`,
                            t,
                            (_e, cx) => {
                              owner.sessionLimit += 50;
                              cx.notify();
                            },
                            { height: 28, px: 12, color: t.muted },
                          ),
                        ),
                    ),
                  ),
        ],
        t,
        { p: 0, gap: 0 },
      ),
    );
}

function projectLabelOf(project) {
  const raw = String(project ?? "");
  const parts = raw.replace(/\\/g, "/").replace(/\/+$/, "").split(/[\/-]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : raw || "Unknown";
}

function sessionDetail(owner, t, session) {
  const models = Array.isArray(session.models) ? session.models : [];
  const subagents = Array.isArray(session.subagents) ? session.subagents : [];
  return v_flex()
    .w_full()
    .gap(12)
    .p(14)
    .pl(26)
    .bg(t.background)
    .border_t(1)
    .border_color(t.border)
    .child(
      v_flex()
        .w_full()
        .gap(9)
        .child(
          h_flex()
            .w_full()
            .items_start()
            .gap(10)
            .child(div().w(66).flex_none().text_size(9).font_semibold().text_color(t.dim).child("MODELS"))
            .child(
              div()
                .flex_1()
                .min_w(0)
                .text_size(11)
                .line_height("16px")
                .text_color(t.foreground)
                .child(models.length ? models.join(", ") : "—"),
            ),
        )
        .child(
          h_flex()
            .w_full()
            .gap(8)
            .flex_wrap()
            .children(
              [
                ["Turns", String(session.turns ?? "—")],
                ["Input", tokens(session.inputTokens)],
                ["Output", tokens(session.outputTokens)],
                ["Cache read", tokens(session.cacheReadTokens)],
                ["Cache write", tokens(session.cacheWriteTokens)],
                ["Cache hit", session.cacheHitPercent == null ? "—" : percent(session.cacheHitPercent)],
                ["Duration", formatDuration(session.durationMs)],
                ["Started", dateTimeLabel(session.startedAt)],
              ].map(([label, value]) => miniStat(label, value, t, { size: 11, color: t.muted })),
            ),
        ),
    )
    .when(subagents.length, (el) =>
      el.child(
        v_flex()
          .w_full()
          .gap(5)
          .child(div().text_size(9).font_semibold().text_color(t.dim).child("SUBAGENTS"))
          .children(
            subagents.map((sub) =>
              h_flex()
                .w_full()
                .gap(8)
                .items_center()
                .child(dot(providerColor(sub.provider, t.ansi5), 6))
                .child(div().flex_1().min_w(0).truncate().text_size(10).text_color(t.muted).child(sessionTitle(sub)))
                .child(div().text_size(10).text_color(t.muted).child(money(sub.cost))),
            ),
          ),
      ),
    )
    .child(
      h_flex()
        .w_full()
        .items_center()
        .gap(8)
        .child(div().text_size(9).font_semibold().text_color(t.dim).child("SESSION ID"))
        .child(div().flex_1().min_w(0).truncate().font_family(mono()).text_size(10).text_color(t.muted).child(session.sessionId))
        .child(
          button(
            `cb-copy-session-${session.sessionId}`,
            owner.copied === session.sessionId ? "Copied" : "Copy",
            t,
            (_e, cx) => owner.copy(session.sessionId, cx),
            { height: 22, px: 8, size: 10, color: t.muted },
          ),
        ),
    );
}

export function modelsView(owner, t, data) {
  const meta = new Map();
  for (const row of Array.isArray(data.models) ? data.models : []) {
    if (row?.modelDisplayName) meta.set(row.modelDisplayName, row);
    if (row?.model) meta.set(row.model, row);
  }
  const joined = data.report ? modelRows(data.report, data.models) : [];
  const rows = (joined.length
    ? joined.map((row) => {
        const source = meta.get(row.name) ?? {};
        return {
          id: source.provider ?? "",
          provider: row.provider || source.providerDisplayName || "Unknown",
          name: row.name,
          calls: row.calls,
          tokens: row.tokens,
          input: row.input,
          output: row.output,
          cacheRead: row.cacheRead,
          cacheWrite: row.cacheWrite,
          cost: row.cost,
          oneShot: row.oneShotRate,
          costPerEdit: row.costPerEdit,
          editTurns: row.editTurns,
          oneShotTurns: row.oneShotTurns,
          retriesPerEdit: row.retriesPerEdit,
          task: source.topCategory ?? null,
          unpriced: row.cost === 0 && row.calls > 0,
        };
      })
    : (Array.isArray(data.models) ? data.models : []).map((row) => ({
        id: row.provider ?? "",
        provider: row.providerDisplayName ?? row.provider ?? "Unknown",
        name: row.modelDisplayName ?? row.model ?? "Unknown model",
        calls: Number(row.calls) || 0,
        tokens: Number(row.totalTokens) || sumTokens(row),
        input: Number(row.inputTokens) || 0,
        output: Number(row.outputTokens) || 0,
        cacheRead: Number(row.cacheReadTokens) || 0,
        cacheWrite: Number(row.cacheWriteTokens) || 0,
        cost: Number(row.costUSD) || 0,
        oneShot: null,
        costPerEdit: null,
        editTurns: 0,
        oneShotTurns: 0,
        retriesPerEdit: null,
        task: row.topCategory ?? null,
        unpriced: (Number(row.costUSD) || 0) === 0 && (Number(row.calls) || 0) > 0,
      }))
  ).sort((a, b) => b.cost - a.cost);
  const total = rows.reduce((sum, row) => sum + row.cost, 0);
  const narrow = owner.width < 760;
  const tiny = owner.width < 520;
  const top = rows[0];
  const best = bestOneShot(rows);

  const summary = metricGrid(
    [
      card(
        [
          div().text_size(10).font_semibold().text_color(t.dim).child("MODEL SPEND"),
          div().text_size(24).font_semibold().text_color(t.foreground).child(money(total)),
          div().text_size(11).text_color(t.muted).child(`${rows.length} models used in ${owner.periodLabel().toLowerCase()}`),
        ],
        t,
        { p: 14, gap: 5 },
      ),
      card(
        [
          div().text_size(10).font_semibold().text_color(t.dim).child("TOP MODEL"),
          div().text_size(16).font_semibold().text_color(t.foreground).truncate().child(top?.name ?? "—"),
          div().text_size(11).text_color(t.muted).child(top ? `${money(top.cost)} · ${top.calls.toLocaleString("en-US")} calls` : "No model spend"),
        ],
        t,
        { p: 14, gap: 5 },
      ),
      card(
        [
          div().text_size(10).font_semibold().text_color(t.dim).child("BEST ONE-SHOT"),
          div().text_size(16).font_semibold().text_color(t.foreground).truncate().child(best?.name ?? "—"),
          div().text_size(11).text_color(t.muted).child(
            best?.oneShot != null ? `${percent(best.oneShot)} of edit turns` : "No edit turns yet",
          ),
        ],
        t,
        { p: 14, gap: 5 },
      ),
    ],
    owner,
  );

  const header = h_flex()
    .w_full()
    .items_center()
    .gap(10)
    .px(10)
    .py(6)
    .border_b(1)
    .border_color(t.border)
    .text_size(9)
    .font_semibold()
    .text_color(t.dim)
    .child(div().flex_1().min_w(0).child("MODEL"))
    .when(!tiny, (el) => el.child(div().w(80).child("PROVIDER")))
    .when(!tiny, (el) => el.child(div().w(52).text_right().child("CALLS")))
    .when(!tiny, (el) => el.child(div().w(60).text_right().child("TOKENS")))
    .when(!narrow, (el) => el.child(div().w(72).child("TASK")))
    .when(!narrow, (el) => el.child(div().w(62).text_right().child("ONE-SHOT")))
    .when(!narrow, (el) => el.child(div().w(64).text_right().child("$/EDIT")))
    .child(div().w(76).text_right().child("COST"))
    .when(!narrow, (el) => el.child(div().w(70).child("SHARE")))
    .child(div().w(16));

  return v_flex()
    .w_full()
    .gap(12)
    .child(summary)
    .child(
      card(
        [
          header,
          rows.length
            ? v_flex()
                .w_full()
                .children(
                  rows.map((row) => {
                    const open = owner.expandedModel === row.name;
                    return v_flex()
                      .w_full()
                      .flex_none()
                      .child(
                        h_flex()
                          .id(`cb-model-${row.id}-${row.name}`)
                          .w_full()
                          .items_center()
                          .gap(10)
                          .px(10)
                          .py(9)
                          .border_b(1)
                          .border_color(t.border)
                          .cursor_pointer()
                          .hover((s) => s.bg(t.hover))
                          .on_click((_e, cx) => owner.toggleModel(row.name, cx))
                          .child(
                            h_flex()
                              .flex_1()
                              .min_w(0)
                              .items_center()
                              .gap(8)
                              .child(dot(providerColor(row.id, t.ansi4), 7))
                              .child(
                                div()
                                  .min_w(0)
                                  .truncate()
                                  .text_size(12)
                                  .font_medium()
                                  .text_color(t.foreground)
                                  .child(row.name),
                              )
                              .when(row.unpriced, (el) =>
                                el.child(pill("unpriced", t, { size: 8, height: 15, color: t.working })),
                              ),
                          )
                          .when(!tiny, (el) => el.child(div().w(80).truncate().text_size(10).text_color(t.muted).child(row.provider)))
                          .when(!tiny, (el) =>
                            el.child(div().w(52).text_right().text_size(10).text_color(t.muted).child(row.calls.toLocaleString("en-US"))),
                          )
                          .when(!tiny, (el) =>
                            el.child(div().w(60).text_right().text_size(10).text_color(t.muted).child(tokens(row.tokens))),
                          )
                          .when(!narrow, (el) =>
                            el.child(
                              div()
                                .w(72)
                                .truncate()
                                .text_size(10)
                                .text_color(t.muted)
                                .child(row.task ? row.task.charAt(0).toUpperCase() + row.task.slice(1) : "—"),
                            ),
                          )
                          .when(!narrow, (el) =>
                            el.child(
                              div()
                                .w(62)
                                .text_right()
                                .text_size(10)
                                .text_color(row.oneShot == null ? t.dim : t.muted)
                                .child(row.oneShot == null ? "—" : percent(row.oneShot, 0)),
                            ),
                          )
                          .when(!narrow, (el) =>
                            el.child(
                              div()
                                .w(64)
                                .text_right()
                                .text_size(10)
                                .text_color(t.muted)
                                .child(row.costPerEdit == null ? "—" : money(row.costPerEdit)),
                            ),
                          )
                          .child(div().w(76).text_right().text_size(12).font_medium().text_color(t.foreground).child(money(row.cost)))
                          .when(!narrow, (el) => {
                            const share = sharePct(row.cost, total);
                            return el.child(
                              h_flex()
                                .w(70)
                                .items_center()
                                .gap(6)
                                .child(div().w(26).text_right().text_size(9).text_color(t.dim).child(percent(share, 0)))
                                .child(
                                  div()
                                    .flex_1()
                                    .h(4)
                                    .rounded(2)
                                    .bg(t.raised)
                                    .child(div().h(4).rounded(2).bg(providerColor(row.id, t.ansi4)).w(`${share}%`)),
                                ),
                            );
                          })
                          .child(icon(open ? "chevron-down" : "chevron-right", 13, t.dim)),
                      )
                      .when(open, (el) => el.child(modelDetail(row, total, t)));
                  }),
                )
            : emptyNote("No model usage in this period.", t, { p: 16 }),
          h_flex()
            .w_full()
            .items_center()
            .pt(9)
            .px(10)
            .gap(8)
            .child(div().text_size(10).text_color(t.dim).child("Token counts include cache reads and writes; costs are CodeBurn's API-rate estimates."))
            .child(div().flex_1())
            .child(button("cb-models-new", "Open CodeBurn docs", t, (_e, cx) => owner.openDocs(cx), {
              height: 24,
              px: 8,
              size: 10,
              color: t.muted,
            })),
        ],
        t,
        { p: 0, gap: 0 },
      ),
    );
}

function modelDetail(row, total, t) {
  const share = sharePct(row.cost, total);
  const retries = row.retriesPerEdit == null ? "—" : Number(row.retriesPerEdit).toFixed(1);
  return v_flex()
    .w_full()
    .gap(10)
    .p(12)
    .pl(28)
    .bg(t.background)
    .border_t(1)
    .border_b(1)
    .border_color(t.border)
    .child(
      h_flex()
        .w_full()
        .gap(16)
        .flex_wrap()
        .children([
          miniStat("One-shot rate", row.oneShot == null ? "—" : percent(row.oneShot, 0), t, { size: 12, color: t.muted }),
          miniStat("Cost / edit", row.costPerEdit == null ? "—" : money(row.costPerEdit), t, { size: 12, color: t.muted }),
          miniStat("Retries / edit", retries, t, { size: 12, color: t.muted }),
          miniStat("Share of spend", percent(share, 1), t, { size: 12, color: t.muted }),
        ]),
    )
    .child(
      h_flex()
        .w_full()
        .gap(16)
        .flex_wrap()
        .children([
          miniStat("Input", tokens(row.input), t, { size: 11, color: t.muted }),
          miniStat("Output", tokens(row.output), t, { size: 11, color: t.muted }),
          miniStat("Cache read", tokens(row.cacheRead), t, { size: 11, color: t.muted }),
          miniStat("Cache write", tokens(row.cacheWrite), t, { size: 11, color: t.muted }),
        ]),
    )
    .child(
      div()
        .text_size(10)
        .text_color(t.dim)
        .child(
          `${row.editTurns.toLocaleString("en-US")} edit turns · ${row.oneShotTurns.toLocaleString("en-US")} one-shot · ${row.calls.toLocaleString("en-US")} calls`,
        ),
    );
}

function bestOneShot(rows) {
  return rows
    .filter((row) => row.oneShot != null && row.editTurns > 0 && row.calls >= 5)
    .sort((a, b) => b.oneShot - a.oneShot)[0];
}

export function optimizeView(owner, t, data) {
  const report = data.optimize;
  if (!report) {
    return v_flex()
      .w_full()
      .gap(12)
      .child(metricGrid([skeletonCard(t, 3), skeletonCard(t, 3), skeletonCard(t, 3)], owner))
      .child(card([skeleton(t, { width: "35%", height: 14 }), rowsSkeleton(t, 5)], t, { p: 16 }));
  }
  const summary = report.summary ?? {};
  const findings = [...(report.findings ?? [])].sort((a, b) => {
    const rank = { high: 0, critical: 0, medium: 1, low: 2 };
    const bySeverity = (rank[a.severity] ?? 3) - (rank[b.severity] ?? 3);
    return bySeverity || (Number(b.estimatedSavingsUSD) || 0) - (Number(a.estimatedSavingsUSD) || 0);
  });
  const tone = healthTone(summary.healthGrade);
  const toneColor = tone === "done" ? t.done : tone === "working" ? t.working : t.blocked;

  const hero = metricGrid(
    [
      card(
        [
          div().text_size(10).font_semibold().text_color(t.dim).child("SETUP HEALTH"),
          h_flex()
            .items_end()
            .gap(8)
            .child(div().text_size(34).font_bold().text_color(toneColor).child(summary.healthGrade ?? "—"))
            .child(div().pb(6).text_size(11).text_color(t.muted).child(`${summary.healthScore ?? 0}/100`)),
          div().text_size(11).text_color(t.muted).child(`${summary.findingCount ?? findings.length} findings in ${report.period?.label ?? owner.periodLabel()}`),
        ],
        t,
        { p: 14, gap: 5 },
      ),
      card(
        [
          div().text_size(10).font_semibold().text_color(t.dim).child("POTENTIAL SAVINGS"),
          div().text_size(24).font_semibold().text_color(t.done).child(money(summary.potentialSavingsCostUSD)),
          div()
            .text_size(11)
            .text_color(t.muted)
            .child(`${percent(summary.potentialSavingsPercent, 0)} of ${money(summary.periodCostUSD)} · ${tokens(summary.potentialSavingsTokens)} tokens`),
        ],
        t,
        { p: 14, gap: 5 },
      ),
      card(
        [
          div().text_size(10).font_semibold().text_color(t.dim).child("MEASURED SAVINGS"),
          div().text_size(24).font_semibold().text_color(t.foreground).child(money(summary.measuredSavingsUSD)),
          div().text_size(11).text_color(t.muted).child(`${summary.sessions ?? 0} sessions · ${(summary.calls ?? 0).toLocaleString("en-US")} calls analyzed`),
        ],
        t,
        { p: 14, gap: 5 },
      ),
    ],
    owner,
  );

  return v_flex()
    .w_full()
    .gap(12)
    .child(hero)
    .child(
      card(
        [
          h_flex()
            .w_full()
            .items_center()
            .gap(8)
            .child(div().text_size(13).font_semibold().text_color(t.foreground).child("What costs tokens without earning them"))
            .child(div().flex_1())
            .child(
              button("cb-opt-copy-all", "Copy all fixes", t, (_e, cx) => owner.copyAllFixes(findings, cx), {
                height: 26,
                px: 9,
                size: 10,
                color: t.muted,
              }),
            ),
          findings.length
            ? v_flex().w_full().gap(10).children(findings.map((finding) => findingCard(owner, t, finding)))
            : emptyNote("No findings. CodeBurn did not find wasted tokens in this period.", t, { p: 16 }),
          div()
            .text_size(10)
            .line_height("15px")
            .text_color(t.dim)
            .child("Optimize reads session files and your local agent config. Nothing is changed here; copy a fix and apply it yourself."),
        ],
        t,
        { p: 16, gap: 12 },
      ),
    );
}

function findingCard(owner, t, finding) {
  const open = owner.findings.has(finding.id);
  const severity = severityTone(finding.severity);
  const severityColor = severity === "blocked" ? t.blocked : severity === "working" ? t.working : t.muted;
  const classColor =
    finding.class === "fix" ? t.done : finding.class === "nudge" ? t.working : t.muted;
  const hasFix = Boolean(finding.fix?.text);
  const copied = owner.copied === `fix:${finding.id}`;
  return v_flex()
    .w_full()
    .min_w(0)
    .gap(8)
    .p(12)
    .rounded(9)
    .border_1()
    .border_color(t.border)
    .bg(t.background)
    .child(
      h_flex()
        .w_full()
        .items_center()
        .gap(8)
        .flex_wrap()
        .child(dot(severityColor, 7))
        .child(
          div()
            .flex_1()
            .min_w(0)
            .text_size(12)
            .font_medium()
            .text_color(t.foreground)
            .child(finding.title ?? "Finding"),
        )
        .when(finding.class, (el) => el.child(pill(finding.class, t, { size: 9, height: 17, color: classColor })))
        .when(finding.severity, (el) => el.child(pill(finding.severity, t, { size: 9, height: 17, color: severityColor })))
        .child(
          div()
            .text_size(12)
            .font_semibold()
            .text_color(finding.estimatedSavingsUSD > 0 ? t.done : t.muted)
            .child(finding.estimatedSavingsUSD > 0 ? money(finding.estimatedSavingsUSD) : "—"),
        ),
    )
    .child(
      div()
        .w_full()
        .text_size(11)
        .line_height("17px")
        .text_color(t.muted)
        .child(open ? finding.explanation ?? "" : shortText(finding.explanation, 32)),
    )
    .when(Boolean(finding.explanation) && String(finding.explanation).split(/\s+/).length > 32, (el) =>
      el.child(
        h_flex()
          .w_full()
          .child(
            div()
              .id(`cb-finding-toggle-${finding.id}`)
              .cursor_pointer()
              .text_size(10)
              .font_medium()
              .text_color(t.accent)
              .hover((s) => s.underline())
              .on_click((_e, cx) => {
                if (open) owner.findings.delete(finding.id);
                else owner.findings.add(finding.id);
                cx.notify();
              })
              .child(open ? "Show less" : "Show more"),
          ),
      ),
    )
    .when(hasFix, (el) =>
      el.child(
        v_flex()
          .w_full()
          .gap(6)
          .p(9)
          .rounded(7)
          .border_1()
          .border_color(t.border)
          .bg(t.surface)
          .child(
            h_flex()
              .w_full()
              .items_center()
              .gap(8)
              .child(div().flex_1().text_size(10).text_color(t.dim).child(finding.fix.label ?? "Fix"))
              .child(
                button(
                  `cb-fix-copy-${finding.id}`,
                  copied ? "Copied" : "Copy",
                  t,
                  (_e, cx) => owner.copy(`fix:${finding.id}`, cx, finding.fix.text),
                  { height: 22, px: 8, size: 10, color: copied ? t.done : t.muted },
                ),
              ),
          )
          .child(
            div()
              .w_full()
              .font_family(mono())
              .text_size(10)
              .line_height("15px")
              .text_color(t.foreground)
              .child(finding.fix.text),
          ),
      ),
    );
}

export function plansView(owner, t, data) {
  const { available, unavailable } = quotaRows(data.quota);
  if (!data.quota) {
    return v_flex()
      .w_full()
      .gap(12)
      .child(metricGrid([skeletonCard(t, 3), skeletonCard(t, 3)], owner))
      .child(card([rowsSkeleton(t, 5)], t, { p: 16 }));
  }

  const atLimit = available.filter((provider) => provider.windows.some((window) => window.usedPct >= 90));
  return v_flex()
    .w_full()
    .gap(12)
    .child(
      card(
        [
          h_flex()
            .w_full()
            .items_center()
            .gap(14)
            .child(brandMark(40))
            .child(
              v_flex()
                .flex_1()
                .min_w(0)
                .gap(3)
                .child(
                  div()
                    .text_size(14)
                    .font_semibold()
                    .text_color(t.foreground)
                    .child(
                      available.length
                        ? `${available.length} plan${available.length === 1 ? "" : "s"} connected`
                        : "No plans connected",
                    ),
                )
                .child(
                  div()
                    .text_size(11)
                    .text_color(t.muted)
                    .child(
                      atLimit.length
                        ? `${atLimit.map((provider) => provider.name).join(", ")} ${atLimit.length === 1 ? "has" : "have"} a window at or near the limit.`
                        : "These are the live windows your CLIs report. CodeBurn reads them locally and never uploads them.",
                    ),
                ),
            )
            .child(
              button("cb-plans-refresh", "Refresh limits", t, (_e, cx) => owner.refresh(cx, { force: true }), {
                height: 28,
                px: 10,
                color: t.muted,
              }),
            ),
        ],
        t,
        { p: 16 },
      ),
    )
    .when(
      available.length > 0,
      (el) =>
        el.child(
          owner.width >= 860
            ? h_flex()
                .w_full()
                .items_start()
                .gap(12)
                .children(available.map((provider) => div().flex_1().min_w(0).child(planCard(provider, t))))
            : v_flex()
                .w_full()
                .gap(12)
                .children(available.map((provider) => planCard(provider, t))),
        ),
    )
    .when(available.length === 0, (el) =>
      el.child(
        card(
          [
            div().text_size(12).font_medium().text_color(t.foreground).child("Sign in to a metered plan"),
            div()
              .text_size(11)
              .line_height("17px")
              .text_color(t.muted)
              .child("Start Claude Code, Codex or another supported CLI and sign in once. CodeBurn will pick up the plan name and its 5-hour and weekly windows on the next refresh."),
            h_flex()
              .w_full()
              .pt(4)
              .child(
                button("cb-plans-agents", "Open Agent Settings", t, (_e, cx) => owner.backToAgents(cx), {
                  height: 28,
                  px: 10,
                  color: t.muted,
                }),
              ),
          ],
          t,
          { p: 16, gap: 10 },
        ),
      ),
    )
    .when(unavailable.length > 0, (el) =>
      el.child(
        card(
          [
            panelHead("Not connected", t, { badge: `${unavailable.length}` }),
            h_flex()
              .w_full()
              .gap(6)
              .flex_wrap()
              .children(unavailable.map((provider) => pill(provider.name, t, { size: 10, color: t.dim, bg: t.raised, border: false }))),
            div().text_size(10).text_color(t.dim).child("A provider appears here until its CLI is installed and signed in."),
          ],
          t,
          { p: 16, gap: 10 },
        ),
      ),
    );
}

function planCard(provider, t) {
  const worst = worstWindow(provider);
  const tone = planTone(worst);
  const toneColor = tone === "blocked" ? t.blocked : tone === "working" ? t.working : t.done;
  const status = tone === "blocked" ? "At limit" : tone === "working" ? "Filling up" : "Healthy";
  return card(
    [
      h_flex()
        .w_full()
        .items_center()
        .gap(9)
        .child(
          div()
            .size(30)
            .flex_none()
            .flex()
            .items_center()
            .justify_center()
            .rounded(9)
            .bg(`${providerColor(provider.id, t.ansi4)}22`)
            .child(dot(providerColor(provider.id, t.ansi4), 10)),
        )
        .child(
          v_flex()
            .flex_1()
            .min_w(0)
            .gap(2)
            .child(div().text_size(13).font_semibold().text_color(t.foreground).child(provider.name))
            .child(div().text_size(10).text_color(t.dim).child(provider.plan ? `${provider.plan} plan` : "Metered plan")),
        )
        .child(pill(status, t, { size: 9, height: 18, color: toneColor })),
      planWindows(provider, t),
      provider.notes?.length
        ? v_flex()
            .w_full()
            .gap(2)
            .children(provider.notes.map((note) => div().text_size(10).text_color(t.dim).child(note)))
        : null,
      h_flex()
        .w_full()
        .items_center()
        .gap(6)
        .child(div().text_size(9).text_color(t.dim).child(worst ? `${worst.label} window` : "No window reported"))
        .child(div().flex_1())
        .when(worst?.resetsAt, (el) => el.child(div().text_size(9).text_color(t.dim).child(`resets ${resetIn(worst.resetsAt)}`))),
    ].filter(Boolean),
    t,
    { p: 16, gap: 12 },
  );
}
