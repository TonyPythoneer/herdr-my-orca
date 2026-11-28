import { View, div, svg, type AsyncContext, type Color, type NativeElement } from "gpui-kit";
import { h_flex } from "gpui-base";
import { theme, run, layout } from "herdr";
import { startTaskRunner } from "./scheduler.js";
import { IconButton } from "../../primitives/icon-button.js";
import { themeColor } from "../../shared/theme-color.js";

type LayoutNode = {
  id?: unknown;
  active?: unknown;
  children?: readonly (LayoutNode | null | undefined)[] | null;
};

type FooterTheme = {
  surface: Color;
  border: Color;
  muted: Color;
  foreground: Color;
  background: Color;
  hover: Color;
  dim: Color;
};

type SharedAssetPath = `mods/orca-assets/${string}`;

const FOOTER_ICON_DIR = "mods/orca-status-footer";
const SHARED_ASSET_DIR = "mods/orca-assets";
const MAIN_STACK = "main";
const AGENTS_PAGE = "main-agents";
const TASKS_PAGE = "main-tasks";
const COMMAND = {
  selectLayout: "layout.select",
  agentSettings: "orca-header.agent-settings",
  settings: "app.settings",
  palette: "app.palette",
} as const;
const SPACE_PX = 8;
const RADIUS_PX = 8;
const ICON_PX = 14;
const BUTTON_PX = 18;
const TEXT_PX = 12;
const DIVIDER_PX = 12;

const SHARED_ASSET_PATHS: Readonly<Partial<Record<string, SharedAssetPath>>> = Object.freeze({});

function find(node: LayoutNode | null | undefined, id: string): LayoutNode | null {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

function tint(hex: Color, alpha: number): Color {
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
    .toString(16)
    .padStart(2, "0");
  return /^#[0-9a-f]{6}$/i.test(hex) ? `${hex}${a}` : hex;
}

function sharedAsset(path: string): SharedAssetPath {
  return SHARED_ASSET_PATHS[path] ?? `${SHARED_ASSET_DIR}/${path.slice(path.lastIndexOf("/") + 1)}`;
}

export default class WorkspaceChrome extends View {
  init(_props: unknown, cx: AsyncContext): void {
    startTaskRunner(cx);
  }

  footer(t: FooterTheme): NativeElement {
    const row = (
      id: string,
      icon: string,
      label: string,
      action: () => void,
      active = false,
    ): NativeElement =>
      IconButton(id, label, svg(sharedAsset(`${FOOTER_ICON_DIR}/${icon}.svg`)).size(ICON_PX), {
        t,
        size: BUTTON_PX,
        radius: RADIUS_PX,
        tooltip: label,
        active,
        onClick: action,
      });
    const onAgents = find(layout() as LayoutNode | undefined, MAIN_STACK)?.active === AGENTS_PAGE;

    const footerBar = h_flex()
      .size_full()
      .items_center()
      .bg(themeColor(t.surface))
      .border_t(1)
      .border_color(themeColor(t.border))
      .pl(SPACE_PX)
      .pr(SPACE_PX)
      .text_size(TEXT_PX)
      .child(
        h_flex()
          .flex_1()
          .items_center()
          .justify_end()
          .gap(SPACE_PX)

          .child(row("agents", "bot", "Agents", () => run(COMMAND.agentSettings), onAgents))

          .child(
            row("tasks", "clock", "Tasks", () =>
              run(COMMAND.selectLayout, { stack: MAIN_STACK, child: TASKS_PAGE }),
            ),
          )
          .child(row("settings", "settings", "Settings", () => run(COMMAND.settings)))

          .child(row("help", "circle-help", "Help", () => run(COMMAND.palette)))

          .child(
            div()
              .w(1)
              .h(DIVIDER_PX)
              .flex_none()
              .bg(tint(themeColor(t.muted), 0.5)),
          ),
      );

    return footerBar;
  }

  render(): NativeElement {
    return this.footer(theme() as FooterTheme);
  }
}
