import {
  div,
  svg,
  type AsyncContext,
  type Context,
  type FocusHandle,
  type ClickEvent,
} from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { closeOverlay, props, run, spaces } from "herdr";
import { closePlan } from "./close-plan.js";
import { DialogButton } from "../../shared/dialog-button.js";
import type { ConfirmClose, HeaderProps, HeaderTheme } from "./types.js";
import { headerTheme } from "./theme.js";

export type DialogView = {
  dontAskAgain?: boolean;
  handle?: FocusHandle;
};

type DialogCopy = { title: string; desc: string; confirmLabel: string };

function dialogCopy(kind: string, cfg: ConfirmClose): DialogCopy {
  if (kind === "agent")
    return {
      title: "Stop this agent?",
      desc: "Closing this terminal will stop the agent's current work.",
      confirmLabel: "Stop Agent",
    };
  if (kind === "pinned")
    return {
      title: "Close pinned tab?",
      desc: "This tab is pinned. Are you sure you want to close it?",
      confirmLabel: "Close",
    };
  if (kind !== "bulk")
    return {
      title: "Stop running command?",
      desc: "Closing this terminal will stop the command running inside it.",
      confirmLabel: "Stop and Close",
    };
  return { ...bulkCopy(cfg), confirmLabel: "Close tabs" };
}

function bulkCopy(cfg: ConfirmClose): { title: string; desc: string } {
  const title = bulkTitle(cfg.scope);
  const n = (cfg.tabIds ?? []).length;
  return {
    title,
    desc: `${n} ${n === 1 ? "tab" : "tabs"} will be closed. Pinned tabs will stay open.`,
  };
}

function bulkTitle(scope: string | undefined): string {
  if (scope === "others") return "Close other tabs?";
  if (scope === "right") return "Close tabs to the right?";
  if (scope === "left") return "Close tabs to the left?";
  return "Close tabs?";
}

function rememberChoice(kind: string): void {
  try {
    if (kind === "pinned") {
      localStorage.setItem("orca.confirmClosePinnedTab", "false");
    } else if (kind === "agent" || kind === "command") {
      localStorage.setItem("orca.skipCloseTerminalWithRunningProcessConfirm", "true");
    }
  } catch {}
}

function closeTabs(view: DialogView, p: HeaderProps, cfg: ConfirmClose, kind: string): void {
  if (view.dontAskAgain) rememberChoice(kind);
  closeOverlay(p.overlay as string);
  if (cfg.tabId) {
    run("tab.close", { id: cfg.tabId });
  } else if (cfg.tabIds) {
    for (const [command, args] of closePlan(spaces(), cfg.tabIds)) run(command, args);
  }
}

function confirmCheckbox(view: DialogView, t: HeaderTheme, isPinned: boolean) {
  const checkboxLabel = isPinned
    ? "Don't ask again for pinned tabs"
    : "Don't ask again for running terminals";
  return h_flex()
    .items_center()
    .gap(8)
    .cursor_pointer()
    .on_click((_e: ClickEvent, cx: Context) => {
      view.dontAskAgain = !view.dontAskAgain;
      cx.notify();
    })
    .child(
      div()
        .size(16)
        .flex_none()
        .rounded(4)
        .border_1()
        .border_color(view.dontAskAgain ? t.solid : t.input)
        .bg(view.dontAskAgain ? t.solid : "#00000000")
        .flex()
        .items_center()
        .justify_center()
        .when(Boolean(view.dontAskAgain), (checkEl) =>
          checkEl.child(svg("mods/orca-assets/check.svg").size(12).text_color(t.solid_foreground)),
        ),
    )
    .child(div().text_size(12).text_color(t.muted).child(checkboxLabel));
}

function dialogFooter(
  t: HeaderTheme,
  confirmLabel: string,
  cancel: () => void,
  confirm: () => void,
) {
  return h_flex()
    .justify_end()
    .gap(8)
    .child(
      DialogButton("close-cancel", "Cancel", {
        t,
        medium: true,
        bg: t.raised,
        color: t.foreground,
        border: t.border,
        hoverBg: t.hover,
        onClick: () => cancel(),
      }),
    )
    .child(
      DialogButton("close-confirm", confirmLabel, {
        t,
        medium: true,
        bg: "#dc2626",
        color: "#ffffff",
        hoverBg: "#b91c1c",
        onClick: () => confirm(),
      }),
    );
}

function dialogHeader(t: HeaderTheme, copy: DialogCopy, cfg: ConfirmClose) {
  return v_flex()
    .gap(4)
    .child(div().text_size(14).font_semibold().text_color(t.foreground).child(copy.title))
    .child(div().text_size(12).text_color(t.muted).child(copy.desc))
    .when(Boolean(cfg.detail), (el) =>
      el.child(
        div()
          .text_size(12)
          .text_color(t.muted)
          .child(cfg.detail as string),
      ),
    );
}

export function renderCloseDialog(view: DialogView, cx: AsyncContext) {
  const t = headerTheme();
  const p: HeaderProps = props() ?? {};
  const cfg: ConfirmClose = p.confirmClose ?? {};
  const kind = cfg.kind ?? "command";
  const isAgent = kind === "agent";
  const isPinned = kind === "pinned";
  const isBulk = kind === "bulk";

  if (!view.handle) {
    view.handle = cx.focus_handle();
    view.handle.focus();
  }

  const copy = dialogCopy(kind, cfg);
  const confirm = () => closeTabs(view, p, cfg, kind);
  const cancel = () => {
    closeOverlay(p.overlay as string);
  };

  return v_flex()
    .id("orca-close-dialog")
    .track_focus(view.handle)
    .on_key_down((e, keyCx) => {
      if (e.key === "enter") {
        keyCx.stop_propagation();
        confirm();
      } else if (e.key === "escape") {
        keyCx.stop_propagation();
        cancel();
      }
    })
    .size_full()
    .p(24)
    .gap(16)
    .rounded(8)
    .bg(t.popover)
    .border_1()
    .border_color(t.border)
    .child(dialogHeader(t, copy, cfg))
    .when(isAgent, (el) =>
      el.child(
        div()
          .text_size(12)
          .text_color(t.muted)
          .child(
            "This terminal will not resume automatically. Cancel and put the workspace to sleep to resume it later.",
          ),
      ),
    )
    .when(Boolean(cfg.tabLabel), (el) =>
      el.child(
        div()
          .truncate()
          .text_size(12)
          .font_medium()
          .text_color(t.foreground)
          .child(cfg.tabLabel as string),
      ),
    )
    .when(!isBulk, (el) => el.child(confirmCheckbox(view, t, isPinned)))
    .child(dialogFooter(t, copy.confirmLabel, cancel, confirm));
}
