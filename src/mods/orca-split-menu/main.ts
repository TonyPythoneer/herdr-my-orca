import {
  View,
  div,
  svg,
  type Color,
  type Context,
  type FocusHandle,
  type KeyEvent,
  type NativeElement,
} from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { panes, run, closeOverlay, theme, props, pickFolder, type PaneInfo } from "herdr";

type SplitTheme = {
  appearance: string;
  foreground: Color;
  popover: Color;
  selected: Color;
  muted: Color;
  border: Color;
};
type SplitProps = { overlay?: string; target?: { pane?: string } };
type SplitSpec = {
  id: string;
  label: string;
  icon: string;
  shortcut: string;
  keys: string[];
  section: string;
  direction: "right" | "down";
  swap?: "left" | "up";
  mod?: string;
};
type Row = Omit<SplitSpec, "direction" | "swap" | "mod"> & {
  direction?: "right" | "down";
  swap?: "left" | "up";
  mod?: string;
  destructive?: boolean;
  action: (cx: Context, overlay: string | undefined) => void;
};

function destructiveColor(): Color {
  const t = theme();
  return (t.appearance === "dark" ? "#ff6568" : "#e40014") as Color;
}

function resolveFocusedPane(): PaneInfo | undefined {
  const p = props() as unknown as SplitProps | undefined;
  const allPanes = panes() ?? [];
  if (p?.target?.pane) {
    const target = allPanes.find((x) => x.pane === p.target?.pane);
    if (target) return target;
  }
  return allPanes.find((x) => x.focused) ?? allPanes[0];
}

const SPLIT_ROWS: SplitSpec[] = [
  {
    id: "split-right",
    label: "Split Terminal Right",
    icon: "panel-right-close.svg",
    shortcut: "1",
    keys: ["1", "r"],
    section: "terminal",
    direction: "right",
  },
  {
    id: "split-left",
    label: "Split Terminal Left",
    icon: "arrow-left.svg",
    shortcut: "2",
    keys: ["2", "l"],
    section: "terminal",
    direction: "right",
    swap: "left",
  },
  {
    id: "split-down",
    label: "Split Terminal Down",
    icon: "panel-bottom-close.svg",
    shortcut: "3",
    keys: ["3", "d"],
    section: "terminal",
    direction: "down",
  },
  {
    id: "split-up",
    label: "Split Terminal Up",
    icon: "arrow-up.svg",
    shortcut: "4",
    keys: ["4", "u"],
    section: "terminal",
    direction: "down",
    swap: "up",
  },
  {
    id: "split-right-files",
    label: "Split Right with File Browser",
    icon: "file-text.svg",
    shortcut: "F",
    keys: ["f"],
    section: "mods",
    direction: "right",
    mod: "orca-files",
  },
  {
    id: "split-down-files",
    label: "Split Down with File Browser",
    icon: "file-text.svg",
    shortcut: "⇧F",
    keys: ["shift+f"],
    section: "mods",
    direction: "down",
    mod: "orca-files",
  },
  {
    id: "split-right-changes",
    label: "Split Right with Git Changes",
    icon: "git-branch.svg",
    shortcut: "C",
    keys: ["c"],
    section: "mods",
    direction: "right",
    mod: "orca-changes",
  },
  {
    id: "split-down-changes",
    label: "Split Down with Git Changes",
    icon: "git-branch.svg",
    shortcut: "⇧C",
    keys: ["shift+c"],
    section: "mods",
    direction: "down",
    mod: "orca-changes",
  },
];

const FOLDER_ROWS: SplitSpec[] = [
  {
    id: "split-folder-right",
    label: "Split in Folder… (Right)",
    icon: "folder.svg",
    shortcut: "O",
    keys: ["7", "o"],
    section: "folder",
    direction: "right",
  },
  {
    id: "split-folder-down",
    label: "Split in Folder… (Down)",
    icon: "folder.svg",
    shortcut: "⇧O",
    keys: ["8", "shift+o"],
    section: "folder",
    direction: "down",
  },
];

function splitRow(spec: SplitSpec, focusedPane: PaneInfo | undefined): Row {
  const { direction, swap, mod, ...row } = spec;
  return {
    ...row,
    action: (_cx, overlay) => {
      closeOverlay(overlay!);
      if (swap && !focusedPane?.pane) return;
      run("pane.split", { direction, pane: focusedPane?.pane, ...(mod ? { mod } : {}) });
      if (swap) run("pane.swap", { pane: focusedPane?.pane, direction });
    },
  };
}

function folderRow(spec: SplitSpec, focusedPane: PaneInfo | undefined): Row {
  const { direction, ...row } = spec;
  return {
    ...row,
    action: (cx, overlay) => {
      const pane = focusedPane?.pane;
      closeOverlay(overlay!);
      cx.spawn(async () => {
        const picked = await pickFolder({
          prompt: `Choose folder for split terminal (${direction})`,
        });
        if (picked) run("pane.split", { direction, pane, folder: picked });
      });
    },
  };
}

function paneRows(focusedPane: PaneInfo | undefined, tabPanes: PaneInfo[]): Row[] {
  return [
    {
      id: "zoom-pane",
      label: "Toggle Expand / Collapse Pane",
      icon: focusedPane?.zoomed ? "minimize-2.svg" : "maximize-2.svg",
      shortcut: "Z",
      keys: ["9", "z"],
      section: "panes",
      action: (_cx, overlay) => {
        closeOverlay(overlay!);
        run("pane.zoom", { pane: focusedPane?.pane });
      },
    },
    {
      id: "close-split",
      label: "Close Split Pane",
      icon: "x.svg",
      shortcut: "X",
      keys: ["0", "x"],
      section: "panes",
      destructive: true,
      action: (_cx, overlay) => {
        closeOverlay(overlay!);
        for (const p of tabPanes) {
          if (p.pane !== focusedPane?.pane) run("pane.close", { pane: p.pane });
        }
      },
    },
  ];
}

const CURSOR_KEYS: Record<string, (at: number, count: number) => number> = {
  down: (at, count) => (at + 1) % count,
  up: (at, count) => (at + count - 1) % count,
  home: () => 0,
  end: (_at, count) => count - 1,
};

const SHIFT_PREFIX = "shift+";
function matchesShortcut(shortcut: string, e: KeyEvent): boolean {
  const key = e.key.toLowerCase();
  const isShift = Boolean(e.modifiers?.shift);
  if (shortcut.startsWith(SHIFT_PREFIX)) {
    const base = shortcut.slice(SHIFT_PREFIX.length);
    return (isShift && key === base) || e.key === base.toUpperCase();
  }
  return !isShift && key === shortcut;
}

export default class SplitMenu extends View {
  at = 0;
  handle = { focus: () => {} } as unknown as FocusHandle;

  init(_props: unknown, cx: Context) {
    this.at = 0;
    this.handle = cx.focus_handle();
    this.handle.focus();
  }

  items(): Row[] {
    const focusedPane = resolveFocusedPane();
    const allPanes = panes() ?? [];
    const tabPanes = focusedPane ? allPanes.filter((p) => p.tab === focusedPane.tab) : [];
    return [
      ...SPLIT_ROWS.map((row) => splitRow(row, focusedPane)),
      ...FOLDER_ROWS.map((row) => folderRow(row, focusedPane)),
      ...(tabPanes.length > 1 ? paneRows(focusedPane, tabPanes) : []),
    ];
  }

  choose(i: number, cx: Context): void {
    const it = this.items()[i];
    if (!it) return;
    it.action(cx, (props() as unknown as SplitProps | undefined)?.overlay);
  }

  onKey(e: KeyEvent, cx: Context, list: Row[]): void {
    if (list.length === 0) return;
    if (Object.hasOwn(CURSOR_KEYS, e.key)) {
      this.at = CURSOR_KEYS[e.key](this.at, list.length);
      cx.notify();
    } else if (e.key === "enter" || e.key === "space") {
      this.choose(this.at, cx);
    } else if (e.key === "escape") {
      closeOverlay((props() as unknown as SplitProps | undefined)?.overlay!);
    } else {
      const targetIdx = list.findIndex((it) => it.keys?.some((k) => matchesShortcut(k, e)));
      if (targetIdx === -1) return;
      this.at = targetIdx;
      cx.notify();
      this.choose(targetIdx, cx);
    }
  }

  row(list: Row[], i: number, { t, bad }: { t: SplitTheme; bad: string }): NativeElement {
    const it = list[i];
    const prev = list[i - 1];
    const hasSeparator = prev && prev.section !== it.section;
    const isSelected = i === this.at;
    const isRed = Boolean(it.destructive);

    return v_flex()
      .when(hasSeparator, (el: NativeElement) => el.child(div().mx(8).my(4).h(1).bg(t.border)))
      .child(
        h_flex()
          .id(`split-item-${i}`)
          .h(28)
          .px(10)
          .gap(10)
          .rounded(6)
          .items_center()
          .justify_between()
          .line_height("16px")
          .whitespace_nowrap()
          .text_color((isRed ? bad : t.foreground) as Color)
          .when(isSelected, (el: NativeElement) =>
            el.bg(isRed ? (`${bad}1a` as Color) : t.selected),
          )
          .on_hover((hovered: boolean, cx: Context) => {
            if (hovered && this.at !== i) {
              this.at = i;
              cx.notify();
            }
          })
          .on_click((_e: unknown, cx: Context) => this.choose(i, cx))
          .child(
            svg(sharedAsset(`mods/orca-split-menu/${it.icon}`))
              .size(14)
              .flex_none()
              .text_color((isRed ? bad : t.muted) as Color),
          )
          .child(div().flex_1().min_w(0).truncate().child(it.label))
          .child(
            div()
              .pl(14)
              .flex_none()
              .whitespace_nowrap()
              .text_color(t.muted)
              .text_size(11)
              .child(it.shortcut),
          ),
      );
  }

  render() {
    const t = theme() as unknown as SplitTheme;
    const list = this.items();
    if (this.at >= list.length) this.at = Math.max(0, list.length - 1);
    const look = { t, bad: destructiveColor() };

    return v_flex()
      .id("orca-split-menu")
      .track_focus(this.handle)
      .w_full()
      .min_h(0)
      .p(6)
      .bg(t.popover)
      .text_size(13)
      .on_key_down((e: KeyEvent, cx: Context) => this.onKey(e, cx, list))
      .children([
        h_flex()
          .px(10)
          .pt(4)
          .pb(6)
          .items_center()
          .justify_between()
          .child(div().text_size(11).font_semibold().text_color(t.muted).child("SPLIT TERMINAL"))
          .child(div().text_size(10).text_color(t.muted).child("↑↓ Navigate • ↵ Select • Esc")),
        ...list.map((_it, i) => this.row(list, i, look)),
      ]);
  }
}

const SHARED_ASSET_PATHS: Record<string, string> = Object.freeze({
  "mods/orca-split-menu/file-text.svg": "mods/orca-assets/file-text--orca-split-menu.svg",
  "mods/orca-split-menu/folder.svg": "mods/orca-assets/folder--orca-files.svg",
  "mods/orca-split-menu/git-branch.svg": "mods/orca-assets/git-branch--orca-header.svg",
  "mods/orca-split-menu/minimize-2.svg": "mods/orca-assets/minimize-2--orca-context-menu.svg",
  "mods/orca-split-menu/panel-right-close.svg":
    "mods/orca-assets/panel-right-close--orca-context-menu.svg",
  "mods/orca-split-menu/x.svg": "mods/orca-assets/x--orca-context-menu.svg",
});

function sharedAsset(path: string): string {
  return SHARED_ASSET_PATHS[path] ?? `mods/orca-assets/${path.slice(path.lastIndexOf("/") + 1)}`;
}
