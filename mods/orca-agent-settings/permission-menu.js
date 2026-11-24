// The permission dropdown, shared by the all-agents card and every agent's row: one trigger, one
// menu, one item shape. What each agent supports stays in permissions.js; this file only draws it.
import { div, svg } from "gpui-kit";
import { v_flex, h_flex, Popover } from "gpui-base";
import { PERMISSION_DESCRIPTIONS, PERMISSION_LABELS, permissionChoices } from "./permissions.js";

const ICONS = {
  own: "square-terminal",
  custom: "square-terminal",
  ask: "hand",
  auto: "shield-check",
  "full-access": "shield-alert",
};

const permissionIcon = (choice, color, size = 14) =>
  svg(`mods/orca-agent-settings/${ICONS[choice] ?? ICONS.own}.svg`).size(size).flex_none().text_color(color);

const AGENT_OWN = "Terminals and chats follow the agent's own permission settings.";

/**
 * One menu item: { id, label, description, detail, choice (icon), warn, selected, separator,
 * suffix: {choice, label} (the inherited value shown after the label), onPick }.
 * `separator` draws a rule above the item.
 */
function menuItem(menuId, item, active, t) {
  const tone = item.warn ? t.blocked : t.foreground;
  return v_flex()
    .w_full()
    .when(item.separator, (el) => el.child(div().w_full().h(1).my(4).bg(t.border)))
    .child(
      h_flex()
        .id(`am-perm-${menuId}-${item.id}`)
        .w_full()
        .px(8)
        .py(6)
        .gap(8)
        .items_start()
        .rounded(6)
        .cursor_pointer()
        .bg(active ? t.hover : "#00000000")
        .hover((style) => style.bg(t.hover))
        .role("button")
        .accessibility_label(item.label)
        .on_click((_event, cx) => item.onPick(cx))
        .child(div().size(5).mt(6).flex_none().rounded_full().bg(item.selected ? t.foreground : "#00000000"))
        .child(
          v_flex()
            .flex_1()
            .min_w(0)
            .gap(2)
            .child(
              h_flex()
                .gap(6)
                .items_center()
                .when(item.choice, (el) => el.child(permissionIcon(item.choice, tone)))
                .child(div().text_size(12).font_medium().text_color(tone).child(item.label))
                .when(item.suffix, (el) =>
                  el
                    .child(div().text_size(12).text_color(t.muted).child("·"))
                    .child(permissionIcon(item.suffix.choice, item.suffix.warn ? t.blocked : t.muted, 12))
                    .child(
                      div().text_size(12).text_color(item.suffix.warn ? t.blocked : t.muted).child(item.suffix.label),
                    ),
                ),
            )
            .when(item.description, (el) => el.child(div().text_size(11).line_height("15px").text_color(t.muted).child(item.description)))
            .when(item.detail, (el) => el.child(div().text_size(10).text_color(t.dim).child(item.detail))),
        ),
    );
}

/**
 * A Popover: the app's overlay layer anchors it to the trigger, keeps it inside the window, and
 * closes it on an outside press or Escape, so no scroll parent clips it.
 */
export function permissionSelect(spec, t) {
  const tone = spec.warn ? t.blocked : t.foreground;
  const trigger = h_flex()
    .id(`am-perm-${spec.id}`)
    .h(28)
    .px(10)
    .gap(6)
    .flex_none()
    .items_center()
    .rounded(6)
    .border_1()
    .border_color(spec.open ? t.ring : t.input)
    .bg(t.raised)
    .cursor_pointer()
    .role("button")
    .accessibility_label(`${spec.label}: choose permission`)
    .tooltip("Choose how much this agent may do without asking")
    .child(permissionIcon(spec.choice, tone))
    .when(spec.prefix, (el) =>
      el.child(div().text_size(12).font_medium().text_color(t.muted).child(`${spec.prefix} ·`)),
    )
    .child(div().text_size(12).font_medium().text_color(tone).child(spec.label))
    .child(svg("mods/orca-agent-settings/chevron-down.svg").size(12).flex_none().text_color(t.muted));
  return Popover.new(`am-perm-pop-${spec.id}`)
    .open(spec.open)
    .anchor("top_right")
    .on_open_change((open, cx) => spec.onOpenChange(open, cx))
    .trigger(trigger)
    .content(
      v_flex()
        .w(spec.width ?? 320)
        .p(4)
        .gap(1)
        .rounded(8)
        .border_1()
        .border_color(t.border)
        .bg(t.popover)
        .children(spec.items.map((item, index) => menuItem(spec.id, item, spec.active === index, t))),
    );
}

// Names listed under a choice before the rest become "+N".
const DETAIL_NAMES = 3;

/** The agents that take a choice, or why none does; `own` needs no detail. */
function choiceDetail(choice, names) {
  if (choice === "own") return null;
  if (names.length === 0) return "No installed agent supports this choice";
  const extra = names.length > DETAIL_NAMES ? ` +${names.length - DETAIL_NAMES}` : "";
  return `${names.slice(0, DETAIL_NAMES).join(", ")}${extra}`;
}

/** The all-agents menu: ask, approve, full access, then each agent's own settings after a rule. */
export function defaultPermissionItems(owner, managed) {
  const permissions = owner.permissions;
  const order = ["ask", "auto", "full-access", "own"];
  return order.map((choice) => {
    const names = managed
      .filter((row) => (permissionChoices(row.key) ?? []).includes(choice))
      .map((row) => row.name);
    return {
      id: choice,
      label: PERMISSION_LABELS[choice],
      description: PERMISSION_DESCRIPTIONS[choice],
      detail: choiceDetail(choice, names),
      choice,
      warn: choice === "full-access",
      separator: choice === "own",
      selected: permissions.default === choice,
      onPick: (cx) => owner.setDefaultPermission(choice, cx),
    };
  });
}

/**
 * One agent's menu: follow all agents, then only the choices this agent can express, then its own
 * settings. Following is shown whenever the agent can express the all-agents choice.
 */
export function agentPermissionItems(owner, row) {
  const choices = permissionChoices(row.key) ?? [];
  const inherited = owner.permissions.default;
  // Following needs a choice to follow: an agent without the all-agents recipe keeps its own settings.
  const following = choices.includes(inherited) && !row.permissionOverride && row.permission !== "custom";
  const items = [];
  if (choices.includes(inherited)) {
    items.push({
      id: "default",
      label: "Same as all agents",
      choice: null,
      suffix: { choice: inherited, label: PERMISSION_LABELS[inherited], warn: inherited === "full-access" },
      selected: following,
      onPick: (cx) => owner.setAgentPermission(row, "default", cx),
    });
  }
  for (const choice of choices) {
    if (choice === "own") continue;
    items.push({
      id: choice,
      label: PERMISSION_LABELS[choice],
      description: PERMISSION_DESCRIPTIONS[choice],
      choice,
      warn: choice === "full-access",
      separator: items.length > 0 && items.at(-1).id === "default",
      selected: !following && row.permission === choice,
      onPick: (cx) => owner.setAgentPermission(row, choice, cx),
    });
  }
  items.push({
    id: "own",
    label: `Use ${row.name}'s own settings`,
    description: AGENT_OWN,
    choice: "own",
    separator: items.length > 0,
    selected: !following && row.permission === "own",
    onPick: (cx) => owner.setAgentPermission(row, "own", cx),
  });
  return items;
}

/** The trigger text for one agent: the inherited value reads `Same as all agents · Full access`. */
function agentTrigger(owner, row) {
  const inherited = owner.permissions.default;
  if (!row.permissionOverride && row.permission !== "custom" && (permissionChoices(row.key) ?? []).includes(inherited)) {
    return { prefix: "Same as all agents", choice: inherited, label: PERMISSION_LABELS[inherited], warn: inherited === "full-access" };
  }
  if (row.permission === "own") return { choice: "own", label: `Use ${row.name}'s own settings`, warn: false };
  return { choice: row.permission, label: PERMISSION_LABELS[row.permission] ?? "Custom", warn: row.permission === "full-access" };
}

// The line beside an agent's menu: why it shows the choice it shows.
function permissionNote(row, trigger, inherited) {
  const inheritedLabel = PERMISSION_LABELS[inherited].toLowerCase();
  if (row.permission === "custom") return "This command sets its own permission flags; a choice here replaces them.";
  if (row.permissionOverride) return `Set for this agent; every other agent follows ${inheritedLabel}.`;
  if (trigger.prefix) return `Follows all agents (${inheritedLabel}).`;
  return `${row.name} keeps its own permission settings.`;
}

/** The effective permission for one agent, right above the command it is written into. */
export function permissionRow(owner, row, t) {
  const inherited = owner.permissions.default;
  const trigger = agentTrigger(owner, row);
  const note = permissionNote(row, trigger, inherited);
  return v_flex()
    .w_full()
    .gap(6)
    .child(div().text_size(10).font_semibold().text_color(t.dim).child("PERMISSION"))
    .child(
      h_flex()
        .w_full()
        .gap(10)
        .items_center()
        .flex_wrap()
        .child(
          permissionSelect(
            {
              id: row.key,
              open: owner.permissionOpen === row.key,
              active: owner.permissionActive,
              width: 360,
              items: agentPermissionItems(owner, row),
              onOpenChange: (open, cx) => owner.setPermissionMenu(row.key, open, cx),
              ...trigger,
            },
            t,
          ),
        )
        .child(div().flex_1().min_w(140).text_size(11).text_color(t.muted).child(note)),
    );
}
