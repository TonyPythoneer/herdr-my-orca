import { div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { closeOverlay, props, run, spaces, theme } from "herdr";
import { closePlan } from "./close-plan.js";
import { DialogButton } from "./dialog-button.js";

function dialogCopy(kind, cfg) {
  if (kind === "agent") return { title: "Stop this agent?", desc: "Closing this terminal will stop the agent's current work.", confirmLabel: "Stop Agent" };
  if (kind === "pinned") return { title: "Close pinned tab?", desc: "This tab is pinned. Are you sure you want to close it?", confirmLabel: "Close" };
  if (kind !== "bulk") return { title: "Stop running command?", desc: "Closing this terminal will stop the command running inside it.", confirmLabel: "Stop and Close" };
  let title = "Close tabs?";
  if (cfg.scope === "others") title = "Close other tabs?";
  if (cfg.scope === "right") title = "Close tabs to the right?";
  if (cfg.scope === "left") title = "Close tabs to the left?";
  const n = (cfg.tabIds ?? []).length;
  return { title, desc: `${n} ${n === 1 ? "tab" : "tabs"} will be closed. Pinned tabs will stay open.`, confirmLabel: "Close tabs" };
}

function closeTabs(view, p, cfg, kind) {
  if (view.dontAskAgain) {
    try {
      if (kind === "pinned") {
        localStorage.setItem("orca.confirmClosePinnedTab", "false");
      } else if (kind === "agent" || kind === "command") {
        localStorage.setItem("orca.skipCloseTerminalWithRunningProcessConfirm", "true");
      }
    } catch { /* A storage failure must still allow closing. */ }
  }
  closeOverlay(p.overlay);
  if (cfg.tabId) {
    run("tab.close", { id: cfg.tabId });
  } else if (cfg.tabIds) {
    // A space that would lose every tab gets a fresh one first, so the host never turns the
    // last close into `space.close` and asks "Close space?".
    for (const [command, args] of closePlan(spaces(), cfg.tabIds)) run(command, args);
  }
}

function confirmCheckbox(view, t, isPinned) {
  const checkboxLabel = isPinned ? "Don't ask again for pinned tabs" : "Don't ask again for running terminals";
  return h_flex().items_center().gap(8).cursor_pointer()
    .on_click((_e, cx) => {
      view.dontAskAgain = !view.dontAskAgain;
      cx.notify();
    })
    .child(
      div().size(16).flex_none().rounded(4).border_1()
        .border_color(view.dontAskAgain ? t.solid : t.input)
        .bg(view.dontAskAgain ? t.solid : "#00000000")
        .flex().items_center().justify_center()
        .when(view.dontAskAgain, checkEl =>
          checkEl.child(svg("mods/orca-assets/check.svg").size(12).text_color(t.solid_foreground))
        )
    )
    .child(div().text_size(12).text_color(t.muted).child(checkboxLabel));
}

function dialogFooter(t, confirmLabel, cancel, confirm) {
  // Outline, size-sm, then destructive, size-sm.
  return h_flex().justify_end().gap(8)
    .child(DialogButton("close-cancel", "Cancel", { t, medium: true, bg: t.raised, color: t.foreground, border: t.border,
      hoverBg: t.hover, onClick: () => cancel() }))
    .child(DialogButton("close-confirm", confirmLabel, { t, medium: true, bg: "#dc2626", color: "#ffffff",
      hoverBg: "#b91c1c", onClick: () => confirm() }));
}

// Dialog ported from Orca: CloseTerminalDialog.tsx:101-184, PinnedTabCloseDialog.tsx:52-94,
// and BULK_TAB_CLOSE_COPY (bulk-tab-close-confirmation.ts:5-15); layout follows dialog.tsx:139-163.
export function renderCloseDialog(view, cx) {
  const t = theme();
  const p = props() ?? {};
  const cfg = p.confirmClose ?? {};
  const kind = cfg.kind ?? "command";
  const isAgent = kind === "agent";
  const isPinned = kind === "pinned";
  const isBulk = kind === "bulk";

  if (!view.handle) {
    view.handle = cx.focus_handle();
    view.handle.focus();
  }

  const { title, desc, confirmLabel } = dialogCopy(kind, cfg);
  const confirm = () => closeTabs(view, p, cfg, kind);
  const cancel = () => {
    closeOverlay(p.overlay);
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
    // DialogHeader (dialog.tsx:139-147).
    .child(
      v_flex().gap(4)
        .child(div().text_size(14).font_semibold().text_color(t.foreground).child(title))
        .child(div().text_size(12).text_color(t.muted).child(desc))
        // The project-level close says how much it covers ("N tabs in M worktrees").
        .when(Boolean(cfg.detail), el =>
          el.child(div().text_size(12).text_color(t.muted).child(cfg.detail)))
    )
    // CloseTerminalDialog.tsx:132-139.
    .when(isAgent, el =>
      el.child(div().text_size(12).text_color(t.muted).child("This terminal will not resume automatically. Cancel and put the workspace to sleep to resume it later."))
    )
    // CloseTerminalDialog.tsx:140-144.
    .when(Boolean(cfg.tabLabel), el =>
      el.child(div().truncate().text_size(12).font_medium().text_color(t.foreground).child(cfg.tabLabel))
    )
    // CloseTerminalDialog.tsx:145-159 & PinnedTabCloseDialog.tsx:72-84.
    .when(!isBulk, el =>
      el.child(confirmCheckbox(view, t, isPinned))
    )
    // DialogFooter (dialog.tsx:149-163).
    .child(
      dialogFooter(t, confirmLabel, cancel, confirm)
    );
}
