import {
  View,
  div,
  type AsyncContext,
  type Color,
  type Context,
  type Element,
  type FocusHandle,
  type KeyEvent,
} from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { run, props, closeOverlay, theme, setShared } from "herdr";
import { themeColor } from "../../shared/theme-color.js";

type ConfirmProps = {
  overlay: string;
  command: { name: string; args?: Record<string, unknown> };
  confirmShared?: { key: string; value: unknown };
  title?: string;
  detail?: string;
};

type ConfirmTheme = {
  input: Color;
  raised: Color;
  foreground: Color;
  solid: Color;
  solid_foreground: Color;
  popover: Color;
  dim: Color;
  muted: Color;
};

type ButtonStyle = { border: Color; bg: Color; fg: Color };

const ROOT_ID = "confirm";
const CANCEL_ID = "no";
const CONFIRM_ID = "yes";
const ENTER_KEY = "enter";
const ESCAPE_KEY = "escape";
const DEFAULT_TITLE = "Are you sure?";
const CANCEL_LABEL = "Cancel";
const CONFIRM_LABEL = "Confirm";
const ESCAPE_HINT = "Esc";
const RADIUS = 8;

const readConfirm = (): ConfirmProps => props();
const readDialog = (): Partial<ConfirmProps> => props() ?? {};
const dismiss = (): void => {
  closeOverlay(readConfirm().overlay);
};

function readTheme(): ConfirmTheme {
  const t = theme();
  return {
    input: themeColor(t.input),
    raised: themeColor(t.raised),
    foreground: themeColor(t.foreground),
    solid: themeColor(t.solid),
    solid_foreground: themeColor(t.solid_foreground),
    popover: themeColor(t.popover),
    dim: themeColor(t.dim),
    muted: themeColor(t.muted),
  };
}

function dialogHeader(t: ConfirmTheme, title: string): Element {
  return h_flex()
    .items_center()
    .child(div().flex_1().text_size(15).font_semibold().text_color(t.foreground).child(title))
    .child(div().text_size(11).text_color(t.dim).child(ESCAPE_HINT));
}

function dialogBody(t: ConfirmTheme, detail: string): Element {
  return div().flex_1().min_h(0).overflow_y_scrollbar().text_color(t.muted).child(detail);
}

function confirmButton(
  id: string,
  label: string,
  style: ButtonStyle,
  onClick: () => void,
): Element {
  return h_flex()
    .id(id)
    .h(32)
    .px(14)
    .items_center()
    .rounded(RADIUS)
    .border_1()
    .border_color(style.border)
    .bg(style.bg)
    .text_color(style.fg)
    .cursor_pointer()
    .hover((s) => s.opacity(0.88))
    .on_click(onClick)
    .child(label);
}

function dialogActions(t: ConfirmTheme, onCancel: () => void, onConfirm: () => void): Element {
  return h_flex()
    .justify_end()
    .gap(8)
    .text_size(12)
    .child(
      confirmButton(
        CANCEL_ID,
        CANCEL_LABEL,
        { border: t.input, bg: t.raised, fg: t.foreground },
        onCancel,
      ),
    )
    .child(
      confirmButton(
        CONFIRM_ID,
        CONFIRM_LABEL,
        { border: t.solid, bg: t.solid, fg: t.solid_foreground },
        onConfirm,
      ),
    );
}

export default class Confirm extends View {
  handle!: FocusHandle;

  init(_props: unknown, cx: AsyncContext): void {
    this.handle = cx.focus_handle();
    this.handle.focus();
  }

  yes(): void {
    const p = readConfirm();
    if (p.confirmShared) setShared(p.confirmShared.key, p.confirmShared.value);
    closeOverlay(p.overlay);
    run(p.command.name, p.command.args ?? {});
  }

  render(_cx: Context): Element {
    const t = readTheme();
    const p = readDialog();
    return v_flex()
      .id(ROOT_ID)
      .track_focus(this.handle)
      .on_key_down((e: KeyEvent, cx: Context) => {
        if (e.key === ENTER_KEY) this.yes();
        else if (e.key === ESCAPE_KEY) dismiss();
        else return;
        cx.stop_propagation();
      })
      .size_full()
      .min_h(0)
      .p(18)
      .gap(12)
      .rounded(RADIUS)
      .bg(t.popover)
      .text_size(13)
      .child(dialogHeader(t, p.title ?? DEFAULT_TITLE))
      .child(dialogBody(t, p.detail ?? ""))
      .child(dialogActions(t, dismiss, () => this.yes()));
  }
}
