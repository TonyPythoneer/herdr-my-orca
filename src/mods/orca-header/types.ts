import type { Color } from "gpui-kit";

export type HeaderTheme = {
  surface: Color;
  background: Color;
  foreground: Color;
  muted: Color;
  dim: Color;
  popover: Color;
  border: Color;
  solid: Color;
  solid_foreground: Color;
  input: Color;
  raised: Color;
  hover: Color;
};

export type LayoutNode = {
  id?: string;
  hidden?: boolean;
  size?: { px?: number };
  active?: string;
  children?: LayoutNode[];
  traffic_lights?: number[];
};

export type WindowState = {
  platform?: string;
  titlebar?: string;
  fullscreen?: boolean;
  maximized?: boolean;
};

export type ConfirmClose = {
  kind?: string;
  tabId?: string;
  tabLabel?: string;
  scope?: string;
  tabIds?: string[];
  detail?: string;
};

export type HeaderProps = {
  confirmClose?: ConfirmClose;
  drop?: boolean;
  overlay?: string;
  motion?: string;
  pinSidebarTerminal?: boolean;
  zoom?: number;
  measureSidebar?: boolean;
  measurePanel?: boolean;
};

export type Flag = { px?: number | null; hidden?: boolean };

export type Point = { x: number; y: number };
