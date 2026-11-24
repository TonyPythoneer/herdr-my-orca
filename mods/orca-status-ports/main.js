// Orca's Ports popover: the status bar's plug button and the panel it opens
// (StatusBarSurface.tsx:336, StatusBarPortsPopover in host-connections/PortsStatusSegment.tsx,
// rows in ports-status-popover-rows.tsx).
//
// Two copies of this mod run at once and both are the same view:
//   - the status bar's block draws the plug mark and the workspace-port count, scans every 30 s
//     and publishes the result in `shared` for the next copy to paint before its own scan lands;
//   - the popup copy (`props().panel`) draws Orca's panel: a "Ports" header with the two counts,
//     one section per open space that owns a listener, then the collapsed External Ports section.
// A popup cannot be resized after it opens, so toggling a section closes and reopens it at the
// height the new content needs, keeping its bottom edge on the bar.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { checking, closeOverlay, exec, nextCommand, notify, openOverlay, panes, props, run, setShared, settings, shared, spaces, theme, window as appWindow } from "herdr";
import { PANEL, addressForPort, browserUrlForPort, buildPorts, knownSpaces, panelAt, panelHeight, parseCwds, parseListeners, sections } from "./scan.js";
import { copyText } from "./clip.js";

const SCAN_KEY = "orca-status-ports.scan";
const OVERLAY_KEY = "orca-status-ports.overlay";
// Orca's shared background scan cadence (WorkspacePortScanner), and how long its result may be
// reused for a first paint.
const SCAN_EVERY_MS = 30_000;
const CACHE_FRESH_MS = 30_000;
const ICON = "mods/orca-status-ports";

/** `#rrggbbaa` from a theme colour: Orca's `border-border/40` separators. */
function fade(hex, alpha) {
  const value = String(hex ?? "");
  if (!/^#[0-9a-f]{6}$/i.test(value)) return value;
  return `${value}${Math.round(Math.max(0, Math.min(1, alpha)) * 255).toString(16).padStart(2, "0")}`;
}

export default class Ports extends View {
  init(_props, cx) {
    this.hoveredPort = null;
    this.scanError = null;
    this.scanning = false;
    this.externalOpen = props()?.externalOpen === true;
    // A recent scan paints at once; the scan this copy starts then replaces it.
    const saved = shared(SCAN_KEY);
    this.scanned = saved && Date.now() - saved.at < CACHE_FRESH_MS ? saved.ports : null;
    if (checking()) return;
    this.refresh(cx);
    // The bar owns the background scan (Orca scans while the popover is closed too, so the count
    // on the button is live); the popup only rescans when it opens and after a Stop.
    if (this.isPanel()) return;
    cx.timer.every(SCAN_EVERY_MS, (cx) => this.refresh(cx));
    // `herdr-app do orca-status-ports.open` (or a key bound to it) opens the panel from elsewhere.
    cx.spawn(async (cx) => {
      for (;;) {
        const command = await nextCommand();
        if (command === "open") this.openPanel();
        else if (command === "refresh") this.refresh(cx);
      }
    });
  }

  isPanel() {
    return props()?.panel === true;
  }

  get ports() {
    return this.scanned ?? [];
  }

  /** `lsof` for listeners, then one `lsof` for those processes' folders, as Orca's macOS scan
   *  does; attribution and ordering live in scan.js. */
  async refresh(cx) {
    if (this.scanning) return;
    this.scanning = true;
    this.scanError = null;
    cx.notify();
    try {
      const listeners = parseListeners((await exec("lsof", ["-O", "-nP", "-iTCP", "-sTCP:LISTEN", "-Fpcn"])).stdout);
      const pids = [...new Set(listeners.map((listener) => listener.pid).filter((pid) => pid !== null))];
      const cwds = pids.length
        ? parseCwds((await exec("lsof", ["-O", "-a", "-p", pids.join(","), "-d", "cwd", "-Fn"])).stdout)
        : new Map();
      this.scanned = buildPorts(listeners, cwds, knownSpaces(spaces(), panes()));
      const signature = this.scanned.map((port) => `${port.id}:${port.kind}`).join("|");
      if (signature !== this.lastSignature) {
        this.lastSignature = signature;
        setShared(SCAN_KEY, { at: Date.now(), ports: this.scanned });
      }
    } catch (error) {
      // Keep the last good rows: a failed scan is not proof that the ports are gone.
      this.scanError = String(error?.message ?? error ?? "port scan failed");
    } finally {
      this.scanning = false;
      cx.notify();
    }
  }

  // ---- the status bar's segment -------------------------------------------------------------

  renderButton(cx) {
    const t = theme();
    const view = sections(this.ports);
    const label =
      view.externalCount > 0
        ? `Ports — ${view.workspaceCount} workspace port${view.workspaceCount === 1 ? "" : "s"} · ${view.externalCount} external`
        : `Ports — ${view.workspaceCount} workspace port${view.workspaceCount === 1 ? "" : "s"}`;
    return h_flex().w_full().h_full().items_center().justify_center().pr(10)
      .bg(t.surface).border_t(1).border_color(t.border)
      .child(
        h_flex().id("orca-ports-button").items_center().gap(5).px(4).py(2).rounded(4)
          .role("button").cursor_pointer()
          .accessibility_label(`Ports, ${view.workspaceCount} workspace port${view.workspaceCount === 1 ? "" : "s"}`)
          .tooltip(label)
          .hover((style) => style.bg(t.hover))
          .on_click(() => this.openPanel())
          .child(
            this.scanning
              ? svg(`${ICON}/loader-circle.svg`).size(11).flex_none().text_color(t.muted).spin(1000)
              : svg(`${ICON}/plug.svg`).size(11).flex_none().text_color(t.muted)
          )
          .child(div().text_size(10).text_color(t.muted).child(String(view.workspaceCount)))
      );
  }

  /** Opens exactly one panel, above the bar at the window's right edge. */
  openPanel() {
    const open = shared(OVERLAY_KEY);
    if (open) closeOverlay(open);
    // The viewport lives on gpui-kit's window, not on herdr's app window (which describes the
    // title bar). Without it the panel would be placed for a guessed window size.
    const size = globalThis.window?.viewport_size?.() ?? null;
    const height = panelHeight(sections(this.ports), false);
    const at = panelAt(size?.width ?? 1440, size?.height ?? 900, height);
    const id = openOverlay({
      mod: "orca-status-ports",
      kind: "popup",
      width: PANEL.width,
      height,
      at,
      props: { panel: true, externalOpen: false, anchor: { x: at.x, bottom: (size?.height ?? 900) - PANEL.bar - PANEL.margin } },
    });
    setShared(OVERLAY_KEY, id);
  }

  // ---- the popover --------------------------------------------------------------------------

  /** A section opens and closes by reopening the popup at the size it needs: the bottom edge
   *  stays on the bar, as if it grew upward (Orca's anchored popover does the same). */
  toggleExternal() {
    const overlay = props()?.overlay;
    const anchor = props()?.anchor;
    this.externalOpen = !this.externalOpen;
    if (!overlay) return;
    closeOverlay(overlay);
    const height = panelHeight(sections(this.ports), this.externalOpen);
    openOverlay({
      mod: "orca-status-ports",
      kind: "popup",
      width: PANEL.width,
      height,
      at: anchor ? { x: anchor.x, y: Math.max(PANEL.margin, anchor.bottom - height) } : "pointer",
      props: { panel: true, externalOpen: this.externalOpen, anchor },
    });
  }

  /** Named `closePanel`, not `close`: the host calls a view's own `close(cx)` on teardown. */
  closePanel() {
    closeOverlay(props()?.overlay);
  }

  goToSpace(spaceId) {
    run("space.select", { id: spaceId });
    this.closePanel();
  }

  openInBrowser(port) {
    const url = browserUrlForPort(port);
    const opener = appWindow().platform === "macos" ? "open" : "xdg-open";
    exec(opener, [url]).catch((error) =>
      notify({ title: "Failed to open browser", body: String(error?.message ?? error), level: "error" })
    );
  }

  copyAddress(port, cx) {
    copyText(addressForPort(port), cx);
    notify({ title: `Copied ${addressForPort(port)}`, level: "success" });
  }

  /** Orca stops only a port a workspace owns (PortsPopover's `canStop`); another program's
   *  listener is not ours to end. */
  canStop(port) {
    return port.kind === "workspace" && Boolean(port.pid) && port.processName !== "Electron";
  }

  stop(port, cx) {
    if (!this.canStop(port)) return;
    exec("/bin/kill", ["-TERM", String(port.pid)])
      .then(() => {
        notify({ title: `Stopped process on :${port.port}`, level: "success" });
        return this.refresh(cx);
      })
      .catch((error) => notify({ title: `Could not stop :${port.port}`, body: String(error?.message ?? error), level: "error" }));
  }

  mono() {
    return settings()?.font_family ?? "JetBrains Mono";
  }

  iconButton(id, icon, label, onClick) {
    const t = theme();
    return h_flex().id(id).size(20).flex_none().items_center().justify_center().rounded(4)
      .role("button").cursor_pointer().text_color(t.muted).tooltip(label).accessibility_label(label)
      .hover((style) => style.bg(t.hover).text_color(t.foreground))
      .on_click(onClick)
      .child(svg(`${ICON}/${icon}.svg`).size(12).flex_none());
  }

  header(t, view) {
    return h_flex().w_full().h(PANEL.header).flex_none().items_center().justify_between().gap(8).px(12)
      .border_b(1).border_color(t.border)
      .child(
        h_flex().items_center().gap(6).min_w(0)
          .child(svg(`${ICON}/plug.svg`).size(12).flex_none().text_color(t.muted))
          .child(div().min_w(0).truncate().text_size(11).font_medium().text_color(t.foreground).child("Ports"))
      )
      .child(
        h_flex().flex_none().items_center().gap(8)
          .child(div().text_size(11).text_color(t.muted).child(`${view.workspaceCount} workspace · ${view.externalCount} external`))
          // The Floating Workspace header's × (orca-float-workspace): size-6 rounded-md outline button.
          .child(div().id("ports-close").size(24).flex_none().flex().items_center().justify_center().rounded(6)
            .border_1().border_color(t.border).bg(t.raised).text_color(t.foreground).text_size(14)
            .cursor_pointer().hover((style) => style.bg(t.hover).text_color(t.foreground))
            .role("button").accessibility_label("Close").tooltip("Close")
            .on_click(() => this.closePanel())
            .child("×"))
      );
  }

  /** Orca's section: a top border on every group but the first, and one under its header. */
  groupHeader(t, group, first) {
    return h_flex().w_full().h(PANEL.group).flex_none().items_center().justify_between().gap(8).px(12)
      .border_b(1).border_color(fade(t.border, 0.4))
      .when(!first, (element) => element.border_t(1).border_color(fade(t.border, 0.4)))
      .child(div().min_w(0).truncate().text_size(12).font_medium().text_color(t.foreground).child(group.displayName || "Workspace"))
      .child(
        h_flex().flex_none().items_center().gap(6)
          .child(this.iconButton(`go-${group.spaceId}`, "folder-open", "Go to Worktree", () => this.goToSpace(group.spaceId)))
          .child(div().font_family(this.mono()).text_size(10).text_color(t.dim).child(String(group.ports.length)))
      );
  }

  externalHeader(t, view) {
    const chevron = this.externalOpen ? "chevron-down" : "chevron-right";
    return h_flex().id("external-ports-toggle").w_full().h(PANEL.group).flex_none().items_center().gap(6).px(12)
      .border_t(1).border_color(fade(t.border, 0.6))
      .role("button").cursor_pointer().hover((style) => style.bg(t.hover))
      .on_click(() => this.toggleExternal())
      .child(svg(`${ICON}/${chevron}.svg`).size(12).flex_none().text_color(t.muted))
      .child(div().text_size(11).font_medium().text_color(t.muted).child("EXTERNAL PORTS"))
      .child(div().flex_1())
      .child(div().flex_none().font_family(this.mono()).text_size(10).text_color(t.dim).child(String(view.externalCount)));
  }

  portRow(t, port, external) {
    const hovered = this.hoveredPort === port.id;
    const name = port.processName ?? (port.pid ? `PID ${port.pid}` : "Unknown process");
    const address = addressForPort(port);
    return h_flex().id(`port-${port.id}`).w_full().h(PANEL.row).flex_none().items_start().gap(8).px(8).py(5).rounded(6)
      .when(hovered, (element) => element.bg(t.hover))
      .on_hover((on, cx) => {
        const next = on ? port.id : this.hoveredPort === port.id ? null : this.hoveredPort;
        if (next !== this.hoveredPort) {
          this.hoveredPort = next;
          cx.notify();
        }
      })
      // Orca: a 4.5rem numeric column, then the process name over its address.
      .child(div().w(72).flex_none().pt(1).font_family(this.mono()).text_size(12).font_semibold().text_color(t.foreground).child(String(port.port)))
      .child(
        v_flex().flex_1().min_w(0).gap(2)
          .child(
            h_flex().relative().w_full().h(18).items_center()
              .child(div().min_w(0).truncate().text_size(11).text_color(t.muted).child(name))
              .when(hovered, (element) => element.child(this.rowActions(t, port)))
          )
          .child(
            div().min_w(0).truncate().text_size(10).text_color(t.dim)
              .child(external ? port.kind : address)
          )
      );
  }

  /** The hover pill: open in browser, copy the address, and Stop for a workspace's own process.
   *  Orca floats it over the process name's line (ports-status-popover-rows.tsx:222-269). */
  rowActions(t, port) {
    const actions = [
      this.iconButton(`open-${port.id}`, "external-link", "Open in Browser", () => this.openInBrowser(port)),
      this.iconButton(`copy-${port.id}`, "copy", `Copy ${addressForPort(port)}`, (event, cx) => this.copyAddress(port, cx)),
    ];
    if (this.canStop(port)) {
      actions.push(this.iconButton(`stop-${port.id}`, "trash", "Stop Process", (event, cx) => this.stop(port, cx)));
    }
    return h_flex().absolute().right(0).top(0).bottom(0).items_center().gap(1).px(2).rounded(6)
      .border_1().border_color(fade(t.border, 0.4)).bg(t.popover)
      .children(actions);
  }

  emptyBody(t, view) {
    if (this.scanError) {
      return div().px(12).py(12).text_size(11).text_color(t.muted)
        .child(`Port scan unavailable: ${this.scanError}`);
    }
    if (view.groups.length > 0) return null;
    return div().px(12).py(16).w_full().text_size(11).text_center().text_color(t.muted)
      .child(this.scanning || this.scanned === null ? "Scanning for workspace ports..." : "No workspace ports detected");
  }

  renderPanel(cx) {
    const t = theme();
    const view = sections(this.ports);
    const empty = this.emptyBody(t, view);
    const rows = [];
    for (const [index, group] of view.groups.entries()) {
      rows.push(this.groupHeader(t, group, index === 0));
      for (const port of group.ports) rows.push(this.portRow(t, port, false));
    }
    const body = [
      ...(empty ? [empty] : []),
      ...rows,
      this.externalHeader(t, view),
      ...(this.externalOpen
        ? view.external.length > 0
          ? view.external.map((port) => this.portRow(t, port, true))
          : [div().px(12).py(8).text_size(11).text_color(t.muted).child("No external ports detected")]
        : []),
    ];
    // The popup is as big as this view, so its width is stated and its body capped rather than
    // stretched: `h_full`/`flex_1` would collapse inside a content-sized overlay.
    return v_flex().id("orca-ports-panel").w(PANEL.width)
      .child(this.header(t, view))
      .child(v_flex().max_h(PANEL.maxBody).overflow_y_scrollbar().children(body));
  }

  render(cx) {
    return this.isPanel() ? this.renderPanel(cx) : this.renderButton(cx);
  }
}
