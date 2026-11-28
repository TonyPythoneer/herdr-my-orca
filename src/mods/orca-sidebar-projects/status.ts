import { div, svg, type Color } from "gpui-kit";

export const STATUS_COLORS: Record<string, Color> = {
  blocked: "#ea580c",
  working: "#eab308",
  done: "#10b981",
  idle: "#73737366",
};

export type StatusColors = Partial<Record<string, Color>>;

const box = (size: number) => div().size(size).flex_none().flex().items_center().justify_center();

const dot = (size: number, inner: number, color: Color) =>
  box(size).child(div().size(inner).rounded_full().flex_none().bg(color));

export function statusMark(status: string, size = 12, colors: StatusColors | null = STATUS_COLORS) {
  const c = colors ?? STATUS_COLORS;
  if (status === "blocked") {
    return box(size).child(
      svg("mods/orca-assets/message-circle-question.svg")
        .size(size)
        .flex_none()
        .text_color(c.blocked ?? STATUS_COLORS.blocked),
    );
  }
  if (status === "working") {
    return box(size).child(
      svg("mods/orca-assets/agent-working-spinner.svg")
        .size(12)
        .flex_none()
        .text_color(c.working ?? STATUS_COLORS.working)
        .spin(1000),
    );
  }
  const emerald = status === "done" || status === "idle";
  return dot(size, 8, emerald ? (c.done ?? STATUS_COLORS.done) : STATUS_COLORS.idle);
}

export function agentStateMark(status: string, colors: StatusColors | null = STATUS_COLORS) {
  const c = colors ?? STATUS_COLORS;
  const size = 10,
    inner = 6;
  if (status === "blocked") {
    return box(size).child(
      svg("mods/orca-assets/message-circle-question.svg")
        .size(size)
        .flex_none()
        .text_color(c.blocked ?? STATUS_COLORS.blocked),
    );
  }
  if (status === "working") {
    return box(size).child(
      svg("mods/orca-assets/agent-working-spinner.svg")
        .size(inner)
        .flex_none()
        .text_color(c.working ?? STATUS_COLORS.working)
        .spin(1000),
    );
  }
  if (status === "done") {
    return box(size).child(
      svg("mods/orca-assets/circle-check.svg")
        .size(size)
        .flex_none()
        .text_color(c.done ?? STATUS_COLORS.done),
    );
  }
  return dot(size, inner, c[status] ?? c.idle ?? STATUS_COLORS[status] ?? STATUS_COLORS.idle);
}
