import { div, svg, type Color, type NativeElement } from "gpui-kit";
import { h_flex, v_flex, Popover } from "gpui-base";
import { PERMISSION_DESCRIPTIONS, PERMISSION_LABELS, permissionChoices } from "./permissions.js";
import { type PartsTheme } from "./parts.js";

const AGENT_OWN = "Terminals and chats follow the agent's own permission settings.";
const DETAIL_NAMES = 3;

type OwnerLike = Record<string, unknown>;
type RowLike = Record<string, unknown>;
// The mod's methods that a picked item calls (main.js); the owner object carries them at runtime.
type PermissionActions = {
  setDefaultPermission: (choice: string, cx: unknown) => unknown;
  setAgentPermission: (row: RowLike, choice: string, cx: unknown) => unknown;
};

function choiceDetail(choice: string, names: string[]): string | null {
  if (choice === "own") return null;
  if (names.length === 0) return "No installed agent supports this choice";
  const extra = names.length > DETAIL_NAMES ? ` +${names.length - DETAIL_NAMES}` : "";
  return `${names.slice(0, DETAIL_NAMES).join(", ")}${extra}`;
}

type MenuItem = {
  id: string;
  label: string;
  choice?: string | null;
  warn?: boolean;
  separator?: boolean;
  selected?: boolean;
  suffix?: { choice: string; label: string; warn?: boolean };
  description?: string;
  detail?: string | null;
  onPick: (cx: unknown) => void;
};

export function defaultPermissionItems(owner: OwnerLike, managed: RowLike[]): MenuItem[] {
  const permissions = (owner as { permissions?: { default?: string } }).permissions ?? {
    default: "ask",
  };
  const defaultChoice = (permissions.default as string) ?? "ask";
  const actions = owner as PermissionActions;
  const order = ["ask", "auto", "full-access", "own"] as const;
  return order.map((choice) => {
    const names = managed
      .filter((row) => (permissionChoices(row.key as string) ?? []).includes(choice))
      .map((row) => row.name as string);
    return {
      id: choice,
      label: PERMISSION_LABELS[choice as keyof typeof PERMISSION_LABELS],
      description: PERMISSION_DESCRIPTIONS[choice as keyof typeof PERMISSION_DESCRIPTIONS],
      detail: choiceDetail(choice, names),
      choice,
      warn: choice === "full-access",
      separator: choice === "own",
      selected: defaultChoice === choice,
      onPick: (cx) => {
        void actions.setDefaultPermission(choice, cx);
      },
    };
  });
}

export function agentPermissionItems(owner: OwnerLike, row: RowLike): MenuItem[] {
  const choices = (permissionChoices(row.key as string) ?? []) as string[];
  const inherited =
    ((owner as { permissions?: { default?: string } }).permissions?.default as string) ?? "ask";

  const following =
    choices.includes(inherited) && !row.permissionOverride && row.permission !== "custom";
  const items: MenuItem[] = [];

  if (choices.includes(inherited)) {
    items.push(makeDefaultItem(inherited, following, owner, row));
  }

  for (const choice of choices) {
    if (choice === "own") continue;
    items.push(makeChoiceItem(choice, following, owner, row));
  }

  items.push(makeOwnItem(following, owner, row, items.length > 0));
  return items;
}

function makeDefaultItem(
  inherited: string,
  following: boolean,
  owner: OwnerLike,
  row: RowLike,
): MenuItem {
  const actions = owner as PermissionActions;
  return {
    id: "default",
    label: "Same as all agents",
    choice: null,
    suffix: {
      choice: inherited,
      label: PERMISSION_LABELS[inherited as keyof typeof PERMISSION_LABELS],
      warn: inherited === "full-access",
    },
    selected: following,
    onPick: (cx) => {
      void actions.setAgentPermission(row, "default", cx);
    },
  };
}

function makeChoiceItem(choice: string, following: boolean, owner: OwnerLike, row: RowLike): MenuItem {
  const actions = owner as PermissionActions;
  return {
    id: choice,
    label: PERMISSION_LABELS[choice as keyof typeof PERMISSION_LABELS],
    description: PERMISSION_DESCRIPTIONS[choice as keyof typeof PERMISSION_DESCRIPTIONS],
    choice,
    warn: choice === "full-access",
    separator: false,
    selected: !following && row.permission === choice,
    onPick: (cx) => {
      void actions.setAgentPermission(row, choice, cx);
    },
  };
}

function makeOwnItem(following: boolean, owner: OwnerLike, row: RowLike, hasPrev: boolean): MenuItem {
  const actions = owner as PermissionActions;
  return {
    id: "own",
    label: `Use ${String(row.name)}'s own settings`,
    description: AGENT_OWN,
    choice: "own",
    separator: hasPrev,
    selected: !following && row.permission === "own",
    onPick: (cx) => {
      void actions.setAgentPermission(row, "own", cx);
    },
  };
}

type PermissionRowOwner = Record<string, unknown>;
type PermissionRowRow = Record<string, unknown>;

export function permissionRow(
  owner: PermissionRowOwner,
  row: PermissionRowRow,
  t: PartsTheme,
): NativeElement {
  const inherited =
    ((owner as { permissions?: { default?: string } }).permissions?.default as string) ?? "ask";
  const inheritedLabel =
    PERMISSION_LABELS[inherited as keyof typeof PERMISSION_LABELS].toLowerCase();
  let noteText: string;
  if ((row.permission as string) === "custom") {
    noteText = "This command sets its own permission flags; a choice here replaces them.";
  } else if (row.permissionOverride as boolean) {
    noteText = `Set for this agent; every other agent follows ${inheritedLabel}.`;
  } else {
    noteText = `Follows all agents (${inheritedLabel}).`;
  }
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
        .child(div().flex_1().min_w(140).text_size(11).text_color(t.muted).child(noteText)),
    );
}

const ICONS = {
  own: "square-terminal",
  custom: "square-terminal",
  ask: "hand",
  auto: "shield-check",
  "full-access": "shield-alert",
} as const;

type IconChoice = keyof typeof ICONS;

function isIconChoice(choice: string): choice is IconChoice {
  return Object.hasOwn(ICONS, choice);
}

const SHARED_ASSET_PATHS: Record<string, string> = Object.freeze({
  "mods/orca-agent-settings/chevron-down.svg":
    "mods/orca-assets/chevron-down--orca-agent-settings.svg",
  "mods/orca-agent-settings/chevron-left.svg":
    "mods/orca-assets/chevron-left--orca-agent-settings.svg",
  "mods/orca-agent-settings/chevron-right.svg":
    "mods/orca-assets/chevron-right--orca-agent-settings.svg",
  "mods/orca-agent-settings/eye.svg": "mods/orca-assets/eye--orca-agent-flyout.svg",
  "mods/orca-agent-settings/square-terminal.svg":
    "mods/orca-assets/square-terminal--orca-agent-settings.svg",
});

function sharedAsset(path: string): string {
  return SHARED_ASSET_PATHS[path] ?? `mods/orca-assets/${path.slice(path.lastIndexOf("/") + 1)}`;
}

function permissionIcon(choice: string, color: Color, size = 14): NativeElement {
  const name = isIconChoice(choice) ? ICONS[choice] : ICONS.own;
  return svg(sharedAsset(`mods/orca-agent-settings/${name}.svg`))
    .size(size)
    .flex_none()
    .text_color(color);
}

function suffixChildren(
  el: NativeElement,
  suffix: MenuItem["suffix"],
  t: PartsTheme,
): NativeElement {
  if (!suffix) return el;
  return el
    .child(div().text_size(12).text_color(t.muted).child("·"))
    .child(permissionIcon(suffix.choice, suffix.warn ? t.blocked : t.muted, 12))
    .child(
      div()
        .text_size(12)
        .text_color(suffix.warn ? t.blocked : t.muted)
        .child(suffix.label),
    );
}

function menuItem(menuId: string, item: MenuItem, active: boolean, t: PartsTheme): NativeElement {
  const tone = item.warn ? t.blocked : t.foreground;
  const choice = item.choice ?? "";
  const description = item.description ?? "";
  const detail = item.detail ?? "";
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
        .child(
          div()
            .size(5)
            .mt(6)
            .flex_none()
            .rounded_full()
            .bg(item.selected ? t.foreground : "#00000000"),
        )
        .child(
          v_flex()
            .flex_1()
            .min_w(0)
            .gap(2)
            .child(
              h_flex()
                .gap(6)
                .items_center()
                .when(choice, (el) => el.child(permissionIcon(choice, tone)))
                .child(div().text_size(12).font_medium().text_color(tone).child(item.label))
                .when(item.suffix, (el) => suffixChildren(el, item.suffix, t)),
            )
            .when(description, (el) =>
              el.child(
                div().text_size(11).line_height("15px").text_color(t.muted).child(description),
              ),
            )
            .when(detail, (el) => el.child(div().text_size(10).text_color(t.dim).child(detail))),
        ),
    );
}

type PermissionSelectSpec = {
  id: string;
  label: string;
  choice: string;
  prefix?: string;
  warn?: boolean;
  open: boolean;
  active?: number | null;
  width?: number;
  items: MenuItem[];
  onOpenChange: (open: boolean, cx: unknown) => void;
};

export function permissionSelect(spec: PermissionSelectSpec, t: PartsTheme): NativeElement {
  const tone = spec.warn ? t.blocked : t.foreground;
  const prefix = spec.prefix ?? "";
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
    .when(prefix, (el) =>
      el.child(div().text_size(12).font_medium().text_color(t.muted).child(`${prefix} ·`)),
    )
    .child(div().text_size(12).font_medium().text_color(tone).child(spec.label))
    .child(
      svg("mods/orca-assets/chevron-down--orca-agent-settings.svg")
        .size(12)
        .flex_none()
        .text_color(t.muted),
    );
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
        .children(
          spec.items.map((item, index) => menuItem(spec.id, item, spec.active === index, t)),
        ),
    );
}
