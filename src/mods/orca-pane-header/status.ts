import { div, svg, image, type Color, type Length, type NativeElement } from "gpui-kit";
import { AGENT } from "../../config/definitions/agent-catalog.js";
import { themeColor } from "../../shared/theme-color.js";
import { STATUS, type TerminalInfo } from "./crew.js";

export const ASSET_DIR = "mods/orca-assets";

export type StatusPalette = {
  blocked: Color;
  working: Color;
  done: Color;
  idle: Color;
};

export type MarkTheme = { muted: string };

export const STATUS_COLORS: StatusPalette = {
  blocked: "#ea580c",
  working: "#eab308",
  done: "#10b981",
  idle: "#73737366",
};

const BLOCKED_ICON = `${ASSET_DIR}/message-circle-question.svg`;
const WORKING_ICON = `${ASSET_DIR}/agent-working-spinner.svg`;

const box = (size: Length): NativeElement =>
  div().size(size).flex_none().flex().items_center().justify_center();
const dot = (size: Length, inner: Length, color: Color): NativeElement =>
  box(size).child(div().size(inner).rounded_full().flex_none().bg(color));

export function statusMark(
  status: string | null | undefined,
  size: Length = 12,
  colors: StatusPalette | null = STATUS_COLORS,
): NativeElement {
  const c = colors ?? STATUS_COLORS;
  if (status === STATUS.blocked) {
    return box(size).child(svg(BLOCKED_ICON).size(size).flex_none().text_color(c.blocked));
  }
  if (status === STATUS.working) {
    return box(size).child(svg(WORKING_ICON).size(8).flex_none().text_color(c.working).spin(1000));
  }
  return dot(size, 8, status === STATUS.done ? c.done : c.idle);
}

const MONO = "mono";
const DROID = "droid";
const KILO = "kilo";
const AIDER = "aider";

const OWN_FILLS = new Set([AGENT.omp, DROID, KILO]);
const AGENT_MARKS: Record<string, string> = {
  [AGENT.codex]: MONO,
  [AGENT.omp]: `${ASSET_DIR}/omp.svg`,
  [AGENT.gemini]: `${ASSET_DIR}/gemini.png`,
  [AGENT.cursor]: `${ASSET_DIR}/cursor.png`,
  [AGENT.grok]: `${ASSET_DIR}/grok.png`,
  [AGENT.qoder]: `${ASSET_DIR}/qoder.png`,
  [AGENT.hermes]: `${ASSET_DIR}/hermes.png`,
  [AGENT["dsh-tui"]]: `${ASSET_DIR}/dsh.png`,
  [DROID]: `${ASSET_DIR}/droid.svg`,
  [KILO]: `${ASSET_DIR}/kilo.svg`,
  [AIDER]: `${ASSET_DIR}/aider.svg`,
};

const maskMark = (path: string, size: Length, theme: MarkTheme): NativeElement =>
  svg(path).size(size).flex_none().text_color(themeColor(theme.muted));
const imageMark = (path: string, size: Length): NativeElement =>
  image(path).w(size).h(size).flex_none();

function catalogMark(
  app: string,
  icon: string | null | undefined,
  size: Length,
  theme: MarkTheme,
): NativeElement | null {
  const catalog = AGENT_MARKS[app];
  if (catalog === MONO) return icon ? maskMark(icon, size, theme) : null;
  return OWN_FILLS.has(app) || !catalog.endsWith(".svg")
    ? imageMark(catalog, size)
    : maskMark(catalog, size, theme);
}

type AgentTerm = Pick<TerminalInfo, "report" | "program">;

export function agentMark(
  term: AgentTerm | null | undefined,
  size: Length = 13,
  theme: MarkTheme,
): NativeElement | null {
  const app = term?.report?.app;
  const icon = term?.program?.icon;
  if (app && AGENT_MARKS[app]) return catalogMark(app, icon, size, theme);
  if (!icon) return null;
  return term?.program?.tint ? maskMark(icon, size, theme) : imageMark(icon, size);
}
