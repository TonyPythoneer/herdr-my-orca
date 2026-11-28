import {
  View,
  div,
  svg,
  type AsyncContext,
  type ClickEvent,
  type Color,
  type Context,
} from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import {
  checking,
  closeOverlay,
  exec,
  nextCommand,
  notify,
  openOverlay,
  panes,
  props,
  run,
  setShared,
  settings,
  shared,
  spaces,
  theme,
  window as appWindow,
} from "herdr";
import {
  PANEL,
  addressForPort,
  browserUrlForPort,
  buildPorts,
  knownSpaces,
  panelAt,
  panelHeight,
  parseCwds,
  parseListeners,
  sections,
  type Port,
} from "../../shared/scan.js";
import { copyText } from "../../shared/clip.js";
import { IconButton } from "../../primitives/icon-button.js";
import { themeColor } from "../../shared/theme-color.js";

const MOD = "orca-status-ports";
const SCAN_KEY = "orca-status-ports.scan";
const OVERLAY_KEY = "orca-status-ports.overlay";
const SCAN_EVERY_MS = 30_000;
const CACHE_FRESH_MS = 30_000;
const ICON = "mods/orca-assets";
const PLUG_ICON = `${ICON}/plug--orca-right-sidebar-placeholders.svg`;

type Anchor = { x: number; bottom: number };
type PanelProps = { panel?: boolean; externalOpen?: boolean; overlay?: string; anchor?: Anchor };
type ScanCache = { at: number; ports: Port[] };
type HostWindow = {
  viewport_size?(): { width?: number; height?: number } | null | undefined;
};
type PortSections = ReturnType<typeof sections>;
type PortTheme = {
  surface: Color;
  border: Color;
  hover: Color;
  muted: Color;
  foreground: Color;
  raised: Color;
  dim: Color;
  popover: Color;
  background: Color;
};

function panelProps(): PanelProps | null | undefined {
  return props() as PanelProps | null | undefined;
}

function savedScan(): ScanCache | null | undefined {
  return shared(SCAN_KEY) as ScanCache | null | undefined;
}

function savedOverlay(): string | null | undefined {
  return shared(OVERLAY_KEY) as string | null | undefined;
}

function messageOf(error: unknown): unknown {
  return (error as { message?: unknown } | null | undefined)?.message;
}

function portTheme(): PortTheme {
  const raw = theme();
  return {
    surface: themeColor(raw.surface),
    border: themeColor(raw.border),
    hover: themeColor(raw.hover),
    muted: themeColor(raw.muted),
    foreground: themeColor(raw.foreground),
    raised: themeColor(raw.raised),
    dim: themeColor(raw.dim),
    popover: themeColor(raw.popover),
    background: themeColor(raw.background),
  };
}

function fade(hex: Color | undefined, alpha: number): Color {
  const value = String(hex ?? "");
  if (!/^#[0-9a-f]{6}$/i.test(value)) return value as Color;
  return `${value}${Math.round(Math.max(0, Math.min(1, alpha)) * 255)
    .toString(16)
    .padStart(2, "0")}` as Color;
}

export default class Ports extends View {
  declare hoveredPort: string | null;
  declare scanError: string | null;
  declare scanning: boolean;
  declare externalOpen: boolean;
  declare scanned: Port[] | null;
  declare lastSignature: string | undefined;

  init(_props: unknown, cx: AsyncContext): void {
    this.hoveredPort = null;
    this.scanError = null;
    this.scanning = false;
    this.externalOpen = panelProps()?.externalOpen === true;

    const saved = savedScan();
    this.scanned = saved && Date.now() - saved.at < CACHE_FRESH_MS ? saved.ports : null;
    if (checking()) return;
    this.refresh(cx);

    if (this.isPanel()) return;
    cx.timer.every(SCAN_EVERY_MS, (cxInner) => this.refresh(cxInner));

    cx.spawn(async (cxInner) => {
      for (;;) {
        const command = await nextCommand();
        if (command === "open") this.openPanel();
        else if (command === "refresh") this.refresh(cxInner);
      }
    });
  }

  isPanel(): boolean {
    return panelProps()?.panel === true;
  }

  get ports(): Port[] {
    return this.scanned ?? [];
  }

  async refresh(cx: AsyncContext): Promise<void> {
    if (this.scanning) return;
    this.scanning = true;
    this.scanError = null;
    cx.notify();
    try {
      const listeners = parseListeners(
        (await exec("lsof", ["-O", "-nP", "-iTCP", "-sTCP:LISTEN", "-Fpcn"])).stdout,
      );
      const pids = [
        ...new Set(
          listeners.map((listener) => listener.pid).filter((pid): pid is number => pid !== null),
        ),
      ];
      const cwds = pids.length
        ? parseCwds(
            (await exec("lsof", ["-O", "-a", "-p", pids.join(","), "-d", "cwd", "-Fn"])).stdout,
          )
        : new Map<number, string | null>();
      this.scanned = buildPorts(listeners, cwds, knownSpaces(spaces(), panes()));
      const signature = this.scanned.map((port) => `${port.id}:${port.kind}`).join("|");
      if (signature !== this.lastSignature) {
        this.lastSignature = signature;
        setShared(SCAN_KEY, { at: Date.now(), ports: this.scanned });
      }
    } catch (error: unknown) {
      this.scanError = String(messageOf(error) ?? error ?? "port scan failed");
    } finally {
      this.scanning = false;
      cx.notify();
    }
  }

  renderButton(cx: Context) {
    const t = portTheme();
    const view = sections(this.ports);
    const label =
      view.externalCount > 0
        ? `Ports — ${view.workspaceCount} workspace port${view.workspaceCount === 1 ? "" : "s"} · ${view.externalCount} external`
        : `Ports — ${view.workspaceCount} workspace port${view.workspaceCount === 1 ? "" : "s"}`;
    return h_flex()
      .w_full()
      .h_full()
      .items_center()
      .justify_center()
      .pr(10)
      .bg(t.surface)
      .border_t(1)
      .border_color(t.border)
      .child(
        h_flex()
          .id("orca-ports-button")
          .items_center()
          .gap(5)
          .px(4)
          .py(2)
          .rounded(4)
          .role("button")
          .cursor_pointer()
          .accessibility_label(
            `Ports, ${view.workspaceCount} workspace port${view.workspaceCount === 1 ? "" : "s"}`,
          )
          .tooltip(label)
          .hover((style) => style.bg(t.hover))
          .on_click(() => this.openPanel())
          .child(
            this.scanning
              ? svg(`${ICON}/loader-circle.svg`).size(11).flex_none().text_color(t.muted).spin(1000)
              : svg(PLUG_ICON).size(11).flex_none().text_color(t.muted),
          )
          .child(div().text_size(10).text_color(t.muted).child(String(view.workspaceCount))),
      );
  }

  openPanel(): void {
    const open = savedOverlay();
    if (open) closeOverlay(open);
    const size =
      (globalThis.window as unknown as HostWindow | undefined)?.viewport_size?.() ?? null;
    const height = panelHeight(sections(this.ports), false);
    const at = panelAt(size?.width ?? 1440, size?.height ?? 900, height);
    const id = openOverlay({
      mod: MOD,
      kind: "popup",
      width: PANEL.width,
      height,
      at,
      props: {
        panel: true,
        externalOpen: false,
        anchor: { x: at.x, bottom: (size?.height ?? 900) - PANEL.bar - PANEL.margin },
      },
    });
    setShared(OVERLAY_KEY, id);
  }

  toggleExternal(): void {
    const overlay = panelProps()?.overlay;
    const anchor = panelProps()?.anchor;
    this.externalOpen = !this.externalOpen;
    if (!overlay) return;
    closeOverlay(overlay);
    const height = panelHeight(sections(this.ports), this.externalOpen);
    openOverlay({
      mod: MOD,
      kind: "popup",
      width: PANEL.width,
      height,
      at: anchor ? { x: anchor.x, y: Math.max(PANEL.margin, anchor.bottom - height) } : "pointer",
      props: { panel: true, externalOpen: this.externalOpen, anchor },
    });
  }

  closePanel(): void {
    closeOverlay(panelProps()?.overlay as string);
  }

  goToSpace(spaceId: string): void {
    run("space.select", { id: spaceId });
    this.closePanel();
  }

  openInBrowser(port: Port): void {
    const url = browserUrlForPort(port);
    const opener = (appWindow() as { platform: string }).platform === "macos" ? "open" : "xdg-open";
    exec(opener, [url]).catch((error: unknown) =>
      notify({
        title: "Failed to open browser",
        body: String(messageOf(error) ?? error),
        level: "error",
      }),
    );
  }

  copyAddress(port: Port, cx: Context): void {
    copyText(addressForPort(port), cx);
    notify({ title: `Copied ${addressForPort(port)}`, level: "success" });
  }

  canStop(port: Port): boolean {
    return port.kind === "workspace" && Boolean(port.pid) && port.processName !== "Electron";
  }

  stop(port: Port, cx: AsyncContext): void {
    if (!this.canStop(port)) return;
    exec("/bin/kill", ["-TERM", String(port.pid)])
      .then(() => {
        notify({ title: `Stopped process on :${port.port}`, level: "success" });
        return this.refresh(cx);
      })
      .catch((error: unknown) =>
        notify({
          title: `Could not stop :${port.port}`,
          body: String(messageOf(error) ?? error),
          level: "error",
        }),
      );
  }

  mono(): string {
    return (settings()?.font_family ?? "JetBrains Mono") as string;
  }

  iconButton(
    id: string,
    icon: string,
    label: string,
    onClick: (event: ClickEvent, cx: Context) => void,
  ) {
    return IconButton(id, label, svg(`${ICON}/${icon}.svg`).size(12).flex_none(), {
      t: portTheme(),
      size: 20,
      radius: 4,
      tooltip: label,
      onClick,
    });
  }

  header(t: PortTheme, view: PortSections) {
    return h_flex()
      .w_full()
      .h(PANEL.header)
      .flex_none()
      .items_center()
      .justify_between()
      .gap(8)
      .px(12)
      .border_b(1)
      .border_color(t.border)
      .child(
        h_flex()
          .items_center()
          .gap(6)
          .min_w(0)
          .child(svg(PLUG_ICON).size(12).flex_none().text_color(t.muted))
          .child(
            div()
              .min_w(0)
              .truncate()
              .text_size(11)
              .font_medium()
              .text_color(t.foreground)
              .child("Ports"),
          ),
      )
      .child(
        h_flex()
          .flex_none()
          .items_center()
          .gap(8)
          .child(
            div()
              .text_size(11)
              .text_color(t.muted)
              .child(`${view.workspaceCount} workspace · ${view.externalCount} external`),
          )
          .child(
            IconButton("ports-close", "Close", "×", {
              t,
              size: 24,
              radius: 6,
              border: t.border,
              bg: t.raised,
              color: t.foreground,
              textSize: 14,
              tooltip: "Close",
              onClick: () => this.closePanel(),
            }),
          ),
      );
  }

  groupHeader(t: PortTheme, group: PortSections["groups"][number], first: boolean) {
    return h_flex()
      .w_full()
      .h(PANEL.group)
      .flex_none()
      .items_center()
      .justify_between()
      .gap(8)
      .px(12)
      .border_b(1)
      .border_color(fade(t.border, 0.4))
      .when(!first, (element) => element.border_t(1).border_color(fade(t.border, 0.4)))
      .child(
        div()
          .min_w(0)
          .truncate()
          .text_size(12)
          .font_medium()
          .text_color(t.foreground)
          .child(group.displayName || "Workspace"),
      )
      .child(
        h_flex()
          .flex_none()
          .items_center()
          .gap(6)
          .child(
            this.iconButton(`go-${group.spaceId}`, "folder-open", "Go to Worktree", () =>
              this.goToSpace(group.spaceId),
            ),
          )
          .child(
            div()
              .font_family(this.mono())
              .text_size(10)
              .text_color(t.dim)
              .child(String(group.ports.length)),
          ),
      );
  }

  externalHeader(t: PortTheme, view: PortSections) {
    const chevron = this.externalOpen ? "chevron-down--orca-files" : "chevron-right--orca-files";
    return h_flex()
      .id("external-ports-toggle")
      .w_full()
      .h(PANEL.group)
      .flex_none()
      .items_center()
      .gap(6)
      .px(12)
      .border_t(1)
      .border_color(fade(t.border, 0.6))
      .role("button")
      .cursor_pointer()
      .hover((style) => style.bg(t.hover))
      .on_click(() => this.toggleExternal())
      .child(svg(`${ICON}/${chevron}.svg`).size(12).flex_none().text_color(t.muted))
      .child(div().text_size(11).font_medium().text_color(t.muted).child("EXTERNAL PORTS"))
      .child(div().flex_1())
      .child(
        div()
          .flex_none()
          .font_family(this.mono())
          .text_size(10)
          .text_color(t.dim)
          .child(String(view.externalCount)),
      );
  }

  portRow(t: PortTheme, port: Port, external: boolean) {
    const hovered = this.hoveredPort === port.id;
    const name = port.processName ?? (port.pid ? `PID ${port.pid}` : "Unknown process");
    const address = addressForPort(port);
    return h_flex()
      .id(`port-${port.id}`)
      .w_full()
      .h(PANEL.row)
      .flex_none()
      .items_start()
      .gap(8)
      .px(8)
      .py(5)
      .rounded(6)
      .when(hovered, (element) => element.bg(t.hover))
      .on_hover((on, cx) => {
        let next = this.hoveredPort;
        if (on) next = port.id;
        else if (this.hoveredPort === port.id) next = null;
        if (next !== this.hoveredPort) {
          this.hoveredPort = next;
          cx.notify();
        }
      })
      .child(
        div()
          .w(72)
          .flex_none()
          .pt(1)
          .font_family(this.mono())
          .text_size(12)
          .font_semibold()
          .text_color(t.foreground)
          .child(String(port.port)),
      )
      .child(
        v_flex()
          .flex_1()
          .min_w(0)
          .gap(2)
          .child(
            h_flex()
              .relative()
              .w_full()
              .h(18)
              .items_center()
              .child(div().min_w(0).truncate().text_size(11).text_color(t.muted).child(name))
              .when(hovered, (element) => element.child(this.rowActions(t, port))),
          )
          .child(
            div()
              .min_w(0)
              .truncate()
              .text_size(10)
              .text_color(t.dim)
              .child(external ? port.kind : address),
          ),
      );
  }

  rowActions(t: PortTheme, port: Port) {
    const actions = [
      this.iconButton(`open-${port.id}`, "external-link", "Open in Browser", () =>
        this.openInBrowser(port),
      ),
      this.iconButton(`copy-${port.id}`, "copy", `Copy ${addressForPort(port)}`, (event, cx) =>
        this.copyAddress(port, cx),
      ),
    ];
    if (this.canStop(port)) {
      actions.push(
        this.iconButton(`stop-${port.id}`, "trash", "Stop Process", (event, cx) =>
          this.stop(port, cx),
        ),
      );
    }
    return h_flex()
      .absolute()
      .right(0)
      .top(0)
      .bottom(0)
      .items_center()
      .gap(1)
      .px(2)
      .rounded(6)
      .border_1()
      .border_color(fade(t.border, 0.4))
      .bg(t.popover)
      .children(actions);
  }

  emptyBody(t: PortTheme, view: PortSections) {
    if (this.scanError) {
      return div()
        .px(12)
        .py(12)
        .text_size(11)
        .text_color(t.muted)
        .child(`Port scan unavailable: ${this.scanError}`);
    }
    if (view.groups.length > 0) return null;
    return div()
      .px(12)
      .py(16)
      .w_full()
      .text_size(11)
      .text_center()
      .text_color(t.muted)
      .child(
        this.scanning || this.scanned === null
          ? "Scanning for workspace ports..."
          : "No workspace ports detected",
      );
  }

  renderPanel(cx: Context) {
    const t = portTheme();
    const view = sections(this.ports);
    const empty = this.emptyBody(t, view);
    const rows = [];
    for (const [index, group] of view.groups.entries()) {
      rows.push(this.groupHeader(t, group, index === 0));
      for (const port of group.ports) rows.push(this.portRow(t, port, false));
    }
    const externalRows = () => {
      if (!this.externalOpen) return [];
      if (view.external.length === 0)
        return [
          div().px(12).py(8).text_size(11).text_color(t.muted).child("No external ports detected"),
        ];
      return view.external.map((port) => this.portRow(t, port, true));
    };
    const body = [
      ...(empty ? [empty] : []),
      ...rows,
      this.externalHeader(t, view),
      ...externalRows(),
    ];

    return v_flex()
      .id("orca-ports-panel")
      .w(PANEL.width)
      .child(this.header(t, view))
      .child(v_flex().max_h(PANEL.maxBody).overflow_y_scrollbar().children(body));
  }

  render(cx: Context) {
    return this.isPanel() ? this.renderPanel(cx) : this.renderButton(cx);
  }
}
