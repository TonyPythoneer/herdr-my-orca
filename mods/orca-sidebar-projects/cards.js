// The worktree card: a function of the Spaces view (`owner`), whose state it reads.
import { div, svg, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, agents, run } from "herdr";
import { statusMark, agentStateMark } from "./status.js";
import { getFolderWorkspaceRowGeometry, getFlushWorktreeCardPaddingLeft, WORKTREE_CARD_SURFACE_MARGIN, LEGACY_STATUS_LANE_WIDTH } from "./indentation.js";
import { stop } from "./focus.js";
import { place, base, otherTabs, STATUS_RANK } from "./worktree-plan.js";

// `CompactAgentSummaryButton` (worktree-card-compact-agents.tsx:75-186): the collapsed pill
// draws per-state clusters — `AgentStateDot` + up to 3 overlapping `size-4` agent-type
// avatars + `+N` (`:158-176`) — and the text label is the EXPANDED header only (`:153-157`).
// Groups follow `buildSummaryAgentGroups` (`worktree-card-agent-summary.ts:201-216`) and
// SUMMARY_STATE_ORDER (`:12-26`), restricted to Herdr's four words; the first 3 groups show
// and the rest count (`worktree-card-compact-agents.tsx:78-84`).
const SUMMARY_ORDER = ["blocked", "working", "done", "idle"];
const MAX_SUMMARY_GROUPS = 3;
const MAX_CLUSTER_ICONS = 3;
const AGENT_ICON_SIZE = 13;

// Orca's AgentIcon uses catalog marks/favicons (`worktree-card-compact-agent-row.tsx:241-242`,
// `agent-catalog.tsx:50-122`, `status-bar/icons.tsx:4-22,343-366`,
// `agent-icon-glyphs.tsx:30-62,61-109`, `agent-favicon-assets.ts:1-31,36-65`). Preserve
// colored marks as images because svg() is a one-color mask (gpui-kit.d.ts:20273-20281).
const OWN_FILLS = new Set(["omp", "droid", "kilo"]);
const AGENT_ICON_OVERRIDES = {
  codex: "mods/orca-sidebar-projects/agent-icons/codex.svg",
  omp: "mods/orca-sidebar-projects/omp.svg",
  gemini: "mods/orca-sidebar-projects/agent-icons/gemini.png",
  cursor: "mods/orca-sidebar-projects/agent-icons/cursor.png",
  grok: "mods/orca-sidebar-projects/agent-icons/grok.png",
  qoder: "mods/orca-sidebar-projects/agent-icons/qoder.png",
  hermes: "mods/orca-sidebar-projects/agent-icons/hermes.png",
  "dsh-tui": "mods/orca-sidebar-projects/agent-icons/dsh.png",
  droid: "mods/orca-sidebar-projects/agent-icons/droid.svg",
  kilo: "mods/orca-sidebar-projects/agent-icons/kilo.svg",
  aider: "mods/orca-sidebar-projects/agent-icons/aider.svg",
};

// An agent row shows the agent, not the folder it shares with the space.
function agentTitle(a, w) {
  // `program.agent` is a boolean ("is an agent"), never a name; the user-facing name is
  // `program.name` ("Claude Code", "Neovim"). An empty title/app used to draw `true`.
  const label = a.title || a.app || a.program?.name || "agent";
  return label === w.name || label === `π: ${w.name}` ? (a.app || a.program?.name || "agent") : label;
}

function agentIcon(a, size, t) {
  const p = a.program;
  const override = Object.hasOwn(AGENT_ICON_OVERRIDES, a.app) ? AGENT_ICON_OVERRIDES[a.app] : null;
  // `mono` uses the program glyph; other overrides are bundled marks.
  if (override === "mono") return p?.icon ? svg(p.icon).size(size).flex_none().text_color(t.muted) : null;
  if (override) return OWN_FILLS.has(a.app) || !override.endsWith(".svg")
    ? image(override).w(size).h(size).flex_none()
    : svg(override).size(size).flex_none().text_color(t.muted);
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(t.muted) : image(p.icon).w(size).h(size).flex_none();
}

// worktree-card-compact-agent-row.tsx:301-305 — `flex h-6 items-center gap-1` = 24px,
// `px-1` = 4px, `text-[11px] text-muted-foreground`, and `worktree-agent-row-hover` washes
// the row with `--accent` at 18% in dark (assets/main.css:1568-1584,1787-1795).
// Herdr's `AgentInfo` has no parent/lineage, child count, timestamp or turn text, so Orca's
// `+N` child disclosure, `text-[10px]` timestamp, `" - "` secondary line and `.75rem`
// lineage indent (`worktree-card-compact-agent-row.tsx:226-297`) have no data here.
function agentRow(a, t, w) {
  const type = agentIcon(a, AGENT_ICON_SIZE, t);
  return h_flex().min_w(0).h(24).px(4).gap(4).items_center()
    .text_size(11).line_height("11px").text_color(t.muted)
    .hover((s) => s.bg("#4040402e"))
    .cursor_pointer()
    // Orca's row activates the agent's pane (`worktree-card-compact-agent-row.tsx:311`,
    // `use-worktree-agent-activation.ts:18-52`): it reveals the worktree, focuses the
    // pane, and drops the row when the pane no longer resolves. Herdr's `agent.focus`
    // focuses the agent's own space, tab and pane (`herdr.d.ts:68`), and `agents()` is
    // live, so an address still in it is the resolve check; a vanished one is skipped.
    .on_click((_e, cx) => {
      cx.stop_propagation();
      if (agents().some((x) => x.address === a.address)) run("agent.focus", { terminal: a.address });
    })
    // The card selects on mouse-up, so the row stops the press like the pill does.
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .on_mouse_up("left", (_e, cx) => cx.stop_propagation())
    // AgentStateDot size="sm": 10px box, 6px inner, `done` = CircleCheck
    // (`src/renderer/src/components/AgentStateDot.tsx:114-116,148-157`) — not the card lane's StatusIndicator.
    .child(agentStateMark(a.status))
    .when(Boolean(type), (el) => el.child(type))
    .child(div().min_w(0).flex_1().truncate().child(agentTitle(a, w)));
}

// The states that have agents, in summary order: the first few draw, the rest are only counted.
function summaryGroups(mine) {
  const groups = SUMMARY_ORDER
    .map((state) => ({ state, count: mine.reduce((n, a) => n + (a.status === state ? 1 : 0), 0) }))
    .filter((entry) => entry.count > 0);
  return {
    visible: groups.slice(0, MAX_SUMMARY_GROUPS),
    hiddenCount: groups.slice(MAX_SUMMARY_GROUPS).reduce((n, entry) => n + entry.count, 0),
  };
}

function cluster(group, mine, t) {
  // Herdr has no agent-type; the program table's icon fills Orca's `size-4` identity
  // circle, and is dropped when the table has none — the dot and `+N` still draw.
  const icons = [];
  for (const agent of mine) {
    if (agent.status !== group.state) continue;
    const icon = agentIcon(agent, AGENT_ICON_SIZE, t);
    if (icon) icons.push(icon);
    if (icons.length === MAX_CLUSTER_ICONS) break;
  }
  const hidden = group.count - icons.length;
  return h_flex().flex_none().items_center().gap(2).rounded(2).px(4).py(2).bg("#2a2a2ab3")
    .child(agentStateMark(group.state))
    .child(h_flex().flex_none().items_center().pl(2)
      .children(icons.map((type, i) => div().size(16).flex_none().flex().items_center().justify_center().rounded_full()
        .border_1().border_color("#ffffff0d").bg(t.chrome).when(i > 0, (el) => el.ml(-2)).child(type))))
    // `text-[10px] tabular-nums text-muted-foreground/70`; t.dim is exactly #acacacb3.
    .when(hidden > 0, (el) => el.child(div().flex_none().text_size(10).text_color(t.dim).child(`+${hidden}`)));
}

// One collapsible list for any number of agents, a lone one included. It starts collapsed
// (`worktree-card-agents-expansion-state.ts:12-16`). Non-agent tabs are only counted, below it.
function agentBlock(owner, { w, also }, mine, t) {
  const expanded = owner.expandedAgents.has(w.id);
  const others = otherTabs({ w, also }, mine);
  const otherLabel = `${others.length} other tab${others.length === 1 ? "" : "s"}`;
  const listLabel = `${mine.length} agent${mine.length === 1 ? "" : "s"}`;
  const { visible, hiddenCount } = summaryGroups(mine);
  return v_flex().min_w(0).mt(4).gap(2)
    .child(h_flex().id(`space-agents-${w.id}`).h(24).w_full().min_w(0).px(4).gap(4).items_center().rounded(2)
      .text_size(11).line_height("11px").text_color(t.muted).cursor_pointer()
      .role("button")
      .accessibility_label(expanded ? `Collapse ${listLabel}` : `Expand ${listLabel}`)
      // Only the collapsed pill rests on a surface: `border-worktree-sidebar-border/70` =
      // #ffffff 7% x 70%, `bg-worktree-sidebar-accent/35` = #353535 at 35%
      // (`worktree-card-compact-agents.tsx:104-113`). Hover is a `foreground/[0.035]` wash
      // (`#f0f0f009`), text unchanged.
      .when(!expanded, el => el.border_1().border_color("#ffffff0d").bg("#35353559"))
      .hover((s) => s.bg("#f0f0f009"))
      .on_click((_e, cx) => { cx.stop_propagation(); owner.toggleAgents(w.id, cx); })
      // Orca stops the press on the pill, not only the click
      // (`worktree-card-compact-agent-row.tsx:312-314`). This card activates on mouse-up,
      // so the release is stopped too — stopping only the click left the card selecting.
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_mouse_up("left", (_e, cx) => cx.stop_propagation())
      .when(expanded, el => el.child(div().min_w(0).flex_1().truncate().px(4).font_medium().child(listLabel)))
      .when(!expanded, el => el.child(h_flex().min_w(0).flex_1().items_center().gap(4).overflow_hidden()
        .children(visible.map((group) => cluster(group, mine, t)))
        .when(hiddenCount > 0, (s) => s.child(div().flex_none().text_size(10).text_color(t.dim).child(`+${hiddenCount}`)))))
      .when(others.length > 0, el => el.child(div().flex_none().text_size(10).text_color(t.dim).child(otherLabel)))
      .child(svg(`mods/orca-sidebar-projects/chevron-${expanded ? "down" : "right"}.svg`).size(12).flex_none()))
    .when(expanded, el => el.child(v_flex().min_w(0).gap(2).pt(2).children(mine.map((a) => agentRow(a, t, w)))));
}

// A merged card lights with any of its spaces and rolls all of their tabs up, as one
// worktree with two open sessions is still one worktree. The rollup is the most urgent of
// its sessions (STATUS order: blocked > done > working > idle).
function rolledUpStatus(group) {
  return group.map(s => s.status).reduce((b, s) => ((STATUS_RANK[s] ?? 0) > (STATUS_RANK[b] ?? 0) ? s : b), null);
}

// Orca's worktree card title display (use-worktree-card-linked-details.ts:94-104,
// worktree-card-title-display.ts:38-69, display-name-provenance.ts:9-18):
// 1. Explicit user rename (`w.named`) pins the label.
// 2. Confirmed task/review subjects (`reviewTitle`) take precedence over raw branch identity.
// 3. Fallback to branch, else space/folder name.
function cardTitle(w, branch, review) {
  return w.named ? w.name : (review?.title || (branch || w.name));
}

// Orca's frame geometry (folder-row.tsx:89): every row here is lineage depth 0 (no tree
// indent, no wrapper), `experimentalNewWorktreeCardStyle` is false so the lane is the
// LEGACY one, and a folder workspace is a folder-group child at groupDepth 1 — both paths
// land on the same 13px anchor.
function cardGeometry(g) {
  return getFolderWorkspaceRowGeometry({
    experimentalNewWorktreeCardStyle: false,
    isFolderBackedWorkspaceChild: !g,
    isGrouped: Boolean(g),
    groupDepth: g ? 0 : 1,
    lineageDepth: 0,
  });
}

// A worktree with no space opens one in its folder; anything else selects the space.
function activateCard(w, g, unopened) {
  if (unopened) run("space.new", { folder: g.top, machine: w.machine ?? "" });
  else run("space.select", { id: w.id });
  run("layout.select", { stack: "main", child: "main-terminals" });
}

// `WorktreeSidebarDropIndicator.tsx:17-25` — the indicator is not a bar: it is
// `absolute left-3 right-2 z-30 flex h-3 -translate-y-1/2 items-center` holding
//   <span size-1.5 rounded-full bg-worktree-sidebar-ring shadow-[0_0_0_2px sidebar] />
//   <span h-0.5 flex-1 rounded-full bg-worktree-sidebar-ring shadow-... />
//   <span size-1.5 rounded-full bg-worktree-sidebar-ring shadow-... />
// so a 2px line with a 6px dot at each end, inset 12px left and 8px right, in the
// sidebar's ring colour (#737373 in dark, main.css:391). We drew a full-width 2px bar in
// the theme ACCENT, which was blue — that is the flash the user saw.
// `drop-indicators.tsx:29-32` renders `WorktreeSidebarDropIndicator`, whose row
// (`WorktreeSidebarDropIndicator.tsx:18`) is `absolute left-3 right-2 h-3` — the line is
// drawn only while a card is being dragged and the pointer is over a slot. Its edge follows
// the drag direction: below the hovered card when dragging down, above it when dragging up
// (unknown origin -> above).
function dropIndicator(owner, pos) {
  const fromIndex = owner.rowIndex?.get(owner.pressed) ?? -1;
  return div().absolute().left(12).right(8).h(12).items_center()
    .when(fromIndex >= 0 && fromIndex < pos, line => line.bottom(-6))
    .when(fromIndex < 0 || fromIndex > pos, line => line.top(-6))
    .child(h_flex().w_full().items_center()
      .child(div().size(6).flex_none().rounded_full().bg("#737373"))
      .child(div().h(2).flex_1().rounded_full().bg("#737373"))
      .child(div().size(6).flex_none().rounded_full().bg("#737373")));
}

function pressCard(owner, w, unopened) {
  if (unopened) return;
  owner.pressed = w.id;
  owner.over = w.id;
}

function dragOverCard(owner, w, cx) {
  const source = spaces().find(s => s.id === owner.pressed);
  const over = source && (source.machine ?? null) === (w.machine ?? null) ? w.id : null;
  if (owner.pressed !== null && owner.over !== over) {
    owner.over = over;
    owner.notify(cx);
  }
}

// Releasing on a card selects it, or drops the dragged card after it, or renames it on a double click.
function releaseCard(owner, { w, g, unopened }, e, cx) {
  if (unopened) { activateCard(w, g, true); owner.notify(cx); return; }
  // Orca's card double-click opens the rename editor: `worktree-card-surface.tsx:98`
  // `onDoubleClick={...handleDoubleClick}` -> `use-worktree-card-activation-actions.ts`
  // `openModal('edit-meta', ...)` with `currentDisplayName`. Herdr's equivalent is
  // `space.rename`, and `MouseButtonEvent.click_count` is `2` on a double-click
  // (`gpui-kit.d.ts`, "How many presses in the current sequence") — the same field the
  // tab strip uses. Rename replaces select, as Orca's double-click replaces its click.
  if (e.click_count === 2) {
    owner.pressed = null;
    owner.over = null;
    run("space.rename", { id: w.id });
    owner.notify(cx);
    return;
  }
  const from = owner.pressed;
  const over = owner.over;
  owner.pressed = null;
  owner.over = null;
  if (from !== null && over === w.id && from !== w.id) {
    const index = spaces().findIndex(s => s.id === w.id);
    if (index !== -1) run("space.move", { id: from, index: index + 1 });
  } else if (from === w.id) activateCard(w, g, false);
  owner.notify(cx);
}

// WorktreeCardStatusLane, legacy style (`worktree-card-status-lane.tsx:19-23`): the
// `shrink-0 flex justify-center items-start pt-[2px]` div around the unread button;
// `WorktreeCardStatusSlot.tsx:246-247` sizes that button `size-4` = 16px even when the
// card is not the new style, so the LANE is 16px wide while StatusIndicator's own box
// stays `h-3 w-3` (12px) holding an 8px dot.
function statusLane(owner, w, t, dot) {
  // `unreadActionEnabled = showUnreadAction && !newCardStyle` (`WorktreeCardStatusSlot.tsx:220`):
  // the legacy card always draws the unread button, and `isUnread` is the mod's flag.
  const unread = owner.unread.has(w.id);
  const hot = owner.laneHot === w.id;
  return div().flex_none().w(LEGACY_STATUS_LANE_WIDTH).flex().items_start().justify_center().pt(2)
    // The button itself (`WorktreeCardStatusSlot.tsx:240-252`): `size-4`, centered,
    // `rounded`, `hover:bg-accent/80`; `aria-label` names the action it performs.
    .child(div().id(`space-unread-${w.id}`).size(16).flex_none().flex().items_center().justify_center()
      .rounded(4).cursor_pointer().role("button")
      .accessibility_label(unread ? "Mark as read" : "Mark as unread")
      .tooltip(unread ? "Mark as read" : "Mark as unread")
      .hover(s => s.bg(t.hover))
      // GPUI has no `group-hover`, so the pointer state that reveals the bell is mod state.
      .on_hover((on, cx) => {
        if (on === (owner.laneHot === w.id)) return;
        owner.laneHot = on ? w.id : null;
        owner.notify(cx);
      })
      // `onClick={onToggleUnread}` and `onPointerDown` both stop before the card's own
      // handlers (`WorktreeCardStatusSlot.tsx:242-244`); the card selects on mouse-up, so
      // the release is stopped too (`use-worktree-card-activation-actions.ts:200-206`).
      .on_click((_e, cx) => { cx.stop_propagation(); owner.toggleUnread(w.id, cx); })
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_mouse_up("left", (_e, cx) => cx.stop_propagation())
      // `isUnread` draws the filled amber bell; otherwise the status mark, which the muted
      // bell replaces on hover (`WorktreeCardStatusSlot.tsx:275-285`).
      .when(unread, el => el.child(svg("mods/orca-sidebar-projects/bell-filled.svg").size(13).flex_none().text_color("#f59e0b")))
      .when(!unread && hot, el => el.child(svg("mods/orca-sidebar-projects/bell.svg").size(12).flex_none().text_color(t.muted)))
      .when(!unread && !hot, el => el.child(statusMark(dot, 12))));
}

// The text column: title row, meta row, then the agent summary and the other-tab count.
function cardText(owner, { w, g }, t, { title, metaText, metaMono, others, mine, agentBlockOf }) {
  // `ws.isMain` only marks a repo's own checkout: a plain folder workspace is no one's primary
  // branch, and a linked worktree is secondary to its checkout. `primary` marks the worktree
  // git itself lists first — its own checkout, not a linked one
  // (`worktree-card-header.tsx:115`: `!compactCards && worktree.isMainWorktree && !isFolder`).
  // Orca's parser sets `isMainWorktree: worktrees.length === 0`; ours marks `linked` when the
  // top differs from the common dir's owner, so the check is simply `!linked`.
  const isPrimary = Boolean(g && !g.linked);
  const otherLabel = `${others.length} other tab${others.length === 1 ? "" : "s"}`;
  // `worktree-card-parent-content.tsx:66` — `flex min-w-0 flex-1 flex-col gap-1.5`, so
  // title row to meta row to agent summary is 6px. Herdr's gap() is pixels; 6 is 6.
  return v_flex().flex_1().min_w(0).gap(6)
    // Title row: title, then Orca's primary pill (h-16, px-1.5, 10px).
    .child(h_flex().w_full().min_w(0).gap(6).items_center()
      .child(div().min_w(0).max_w(150).truncate().text_size(13).line_height("20px").text_color(t.foreground).child(title))
      .when(isPrimary, el => el.child(div().flex_none().h(16).px(6).rounded(4).border_1().border_color("#f0f0f033").bg("#f0f0f00f")
        .text_size(10).font_medium().line_height("14px").text_color("#f0f0f0b3").child("primary")))
      // No trailing element: Orca's title row ends at the title (and the primary pill);
      // its right-hand cluster lives in the meta row below.
      .child(div().flex_1()))
    // Meta row: the branch, or the folder's own last segment — 11px muted, mono for paths
    // (`WorktreeCardFolderPath`: `font-mono text-[11px] leading-none`). The review badge
    // sits at the row's end, which is Orca's `ml-auto ... pr-1.5` cluster
    // (WorktreeCardMetaBadges.tsx:86) and the only thing it holds for a classic card.
    .when(Boolean(metaText), el => el.child(h_flex().w_full().min_w(0).items_center()
      .child(div().min_w(0).truncate().text_size(11).line_height("11px").text_color(t.muted).when(metaMono, m => m.font_family("JetBrains Mono")).child(metaText))
      .child(div().flex_1())
      .when(Boolean(owner.reviewOf(g)), row => row.child(owner.prBadge(owner.reviewOf(g), t, w.id, g)))))
    // Orca's compact agent summary (worktree-card-compact-agents.tsx): h-6, px-1, 11px
    // muted; the collapsed pill draws state clusters and the rows carry AgentStateDot.
    .when(mine.length > 0, el => el.child(agentBlockOf()))
    // Tabs that are not agents (shells, editors, mods): a count on the agents header's row,
    // alone only when there is no agent header. Never a row in the agent list.
    .when(others.length > 0 && mine.length === 0, el => el.child(div().mt(4).px(4).text_size(11).line_height("11px").text_color(t.muted).child(otherLabel)));
}

export function cardView(owner, row, t, ps, mine) {
  const { w, g, also, unopened, pos } = row;
  const group = [w, ...(also ?? []).map(a => a.w)];
  const on = group.some(s => s.active);
  const branch = g?.branch ?? w.branch ?? null;
  // `default-workspace-card.json`: folder cards print the folder's own last segment
  // (`folderInMeta`, `WorktreeCardFolderPath` = `getDirectoryName`), branch cards the branch.
  // Orca's classic card draws the branch unconditionally (`default-workspace-card.json`
  // `branch: "!vars.folder && len(ws.branch) > 0 && !vars.newStyle && ..."`,
  // `worktree-card-presentation.tsx:76-80`), and an automatic worktree name IS the branch
  // (`display-name-provenance.ts:17-19`), so Orca really does print `main` twice on such a card.
  const text = {
    title: cardTitle(w, branch, owner.reviewOf(g)),
    metaText: g ? branch : base(place(w, ps)),
    metaMono: !g,
    // Orca's card lists its own agents (inlineAgents) as `AgentStateDot` rows, from agents():
    // the same rows the agents view reads, so a collapsed card shows real rows, never invented.
    // The host already rolled each space's agents up (model.rs:92-97 `priority`).
    others: otherTabs({ w, also }, mine),
    mine,
    agentBlockOf: () => agentBlock(owner, { w, also }, mine, t),
  };
  // Herdr has no sleep state (`Model::status`, model.rs:528-536) and Orca dims only the new
  // card style (`worktree-card-surface.tsx:115-120`), so there is no sleeping dim to port.
  const { surfaceInset, cardContentIndent } = cardGeometry(g);
  // Orca's classic cards are never `singleLine`: `default-workspace-card.json:29` sets
  // `inlineAgents` from `options.show.inlineAgents && !vars.compact`, and the migration adds
  // `inline-agents` to every user's card props (`normalize-loaded-ui-state.ts:106`), so
  // `singleLine` (`default-workspace-card.json:34`) is false even while the card has no agent.
  // `worktree-card-surface.tsx:67` then always draws `pt-1.25 pb-1.5` = 5/6px. Fixed here so
  // an agent starting/stopping cannot resize the row; `mine.length` must not feed the padding.
  return stop(owner, t, `space-${w.id}`, v_flex()
    .relative()
    .id(`space-${w.id}`)
    .ml(WORKTREE_CARD_SURFACE_MARGIN + surfaceInset).pr(6)
    .pt(5).pb(6)
    .flex_none()
    .rounded(8)
    // `worktree-card-surface.tsx:71-76` draws `border border-transparent` on every card, so
    // the active border adds no geometry and the title does not shift 1px on selection.
    .border_1().border_color("#00000000")
    .role("button")
    .accessibility_label(w.name)
    // Orca active card: bg foreground/10 over sidebar, border foreground/18.
    .when(on, (el) => el.bg("#3e3e3e").border_color("#f0f0f02e"))
    // No background change on hover. Orca does have
    // `.worktree-sidebar-card-hover:hover { background: color-mix(in srgb, var(--sidebar-accent)
    // 40%, transparent) }` (main.css:1488), but washing the row repaints the whole project
    // area on every pointer move, which reads as the list flickering. The hover's only job
    // here is to reveal the row's affordances, so that is all it does.
    .when(owner.pressed === w.id && owner.over !== w.id, (el) => el.opacity(0.5))
    .when(owner.pressed !== null && owner.over === w.id && owner.pressed !== w.id, (el) => el.child(dropIndicator(owner, pos)))
    .on_mouse_down("left", () => pressCard(owner, w, unopened))
    .on_mouse_move((_e, cx) => dragOverCard(owner, w, cx))
    .on_mouse_up("left", (e, cx) => releaseCard(owner, row, e, cx))
    .on_mouse_down("right", () => owner.menu(w, g))
    // Card root (worktree-card-surface.tsx): ml-1, py-2 for a title-only card, rounded-lg, and a
    // padding-left that the geometry module derives from the group depth. The content row is
    // `flex gap-0.5 items-start`, so the status lane sits at the top and never drives the title.
    // `worktree-card-parent-content.tsx:56` is the row that actually holds the status lane and
    // the text column: `flex w-full min-w-0 gap-0.5`, so the lane-to-text gap is 2px, not the
    // 8px of the *header* row inside the text column (`worktree-card-header.tsx:65` gap-2,
    // which is lane-external). Alignment there is `items-start` unless the card is title-only;
    // the old `pt(2)` on the lane plus `items_start` is Orca's own optical nudge, and the
    // title's 20px line box is what puts the mark on the first line.
    .child(h_flex().w_full().min_w(0).items_start().gap(2).pl(getFlushWorktreeCardPaddingLeft(cardContentIndent, false))
      .child(statusLane(owner, w, t, rolledUpStatus(group)))
      .child(cardText(owner, row, t, text))),
    // A worktree with no space opens one in its folder; anything else selects the space.
    { radius: 8, enter: () => activateCard(w, g, unopened) });
}

// A repo is a project group: a SectionHeader, then its worktree cards (SectionHeader.tsx:185-195).
// A bare folder workspace renders its folder row above its session card.
