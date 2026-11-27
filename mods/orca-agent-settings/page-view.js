// The Agents page: its header, the all-agents permission card and the catalog sections. Each
// builder takes the page (`owner`) and reads its state; the page's logic stays in main.js.
import { div, svg, image } from "gpui-kit";
import { Button, Link, v_flex, h_flex, Input } from "gpui-base";
import { layout, settings, shared } from "herdr";
import { PERMISSION_LABELS } from "./permissions.js";
import { defaultPermissionItems, permissionSelect } from "./permission-menu.js";
import { permissionSummary } from "./permission-plan.js";
import { timeLabel } from "./util.js";
import { backButton, badge, banner, empty, group, section } from "./parts.js";
import { railRows } from "./agent-rail.js";

// Below this width the page's side padding shrinks.
const NARROW_WIDTH = 520;
// The frames of the spinner shown while a probe runs, and how long each stays.
const SPINNER_FRAMES = ["◐", "◓", "◑", "◒"];
const SPINNER_FRAME_MS = 120;
const spinner = (t, size) => div().flex_none().text_size(size).text_color(t.muted).frames(SPINNER_FRAMES, SPINNER_FRAME_MS);

/** The all-agents permission: one choice, plus the agents that keep their own. */
export function permissionsCardView(owner, rows, t, compact = false) {
  // The page already derived this inventory; avoid rebuilding it for this card.
  const permissions = owner.currentPermissions(rows);
  const managed = rows.filter((row) => row.supports);
  const summary = permissionSummary(managed, permissions);
  return v_flex()
    .w_full()
    .p(12)
    .gap(10)
    .rounded(10)
    .border_1()
    .border_color(t.border)
    .bg(t.surface)
    .child(permissionTitleRow(owner, managed, permissions, t, compact))
    .when(Boolean(summary.exceptionLine) || summary.custom > 0, (el) => el.child(permissionSummaryRow(owner, summary, permissions, t)))
    .when(Boolean(summary.noChoiceLine), (el) => el.child(div().text_size(11).text_color(t.dim).child(summary.noChoiceLine)))
    .when(owner.permissionNotice, (el) => el.child(permissionNoticeRow(owner, t)));
}

export function environmentCardView(owner, t) {
  const on = owner.herdrEnv;
  return v_flex()
    .id("am-herdr-env-card")
    .w_full()
    .p(12)
    .gap(10)
    .rounded(10)
    .border_1()
    .border_color(t.border)
    .bg(t.surface)
    .child(
      h_flex().w_full().items_center().gap(16)
        .child(v_flex().flex_1().min_w(0).gap(3)
          .child(div().text_size(13).font_semibold().text_color(t.foreground).child("Agent environment"))
          .child(div().text_size(11).line_height("16px").text_color(t.muted)
            .child("Adds HERDR_ENV=1 to new agent commands, so tools can tell they are running inside Herdr.")))
        .child(
          div().id("am-herdr-env-toggle").w(36).h(20).flex_none().flex().items_center().p(2).rounded_full()
            .bg(on ? t.foreground : t.input)
            .when(owner.herdrEnvSaving || owner.persisting || owner.managerError, el => el.opacity(0.45))
            .when(!owner.herdrEnvSaving && !owner.persisting && !owner.managerError, el => el.cursor_pointer())
            .role("switch").checked(on)
            .accessibility_label("Add HERDR_ENV=1 to new agent commands")
            .tooltip(owner.herdrEnvSaving ? "Saving…" : "Add HERDR_ENV=1 to new agent commands")
            .when(!owner.herdrEnvSaving && !owner.persisting && !owner.managerError, el => el.on_click((_event, cx) => owner.setHerdrEnv(!on, cx)))
            .child(h_flex().w_full().items_center().when(on, el => el.justify_end())
              .when(!on, el => el.justify_start())
              .child(div().size(16).rounded_full().bg(on ? t.background : t.muted))),
        ),
    );
}

export function gatewayCardView(owner, t) {
  const on = owner.litellmEnabled;
  const local = owner.litellmStatus?.local;
  const quickstart = local?.quickstart;
  const remote = owner.litellmStatus?.remote;
  let health;
  if (owner.litellmMode === "local") {
    if (local?.running && local.healthy && local.usable) health = { text: "Healthy · Managed LiteLLM gateway", color: t.done };
    else if (local?.running && !local.healthy) health = { text: "Gateway process is running but its health check failed", color: t.blocked };
    else if (local?.running) health = { text: "Managed LiteLLM gateway is running", color: t.blocked };
    else if (local?.usable) health = { text: "Ready · Managed LiteLLM installation found; gateway starts on first launch", color: t.muted };
    else if (quickstart?.usable) health = { text: `Local LiteLLM Gateway is ready · ${quickstart.version ?? "version unknown"}; switch to Quickstart to use it`, color: t.done };
    else if (quickstart?.installed) health = { text: `litellm-gateway found at ${quickstart.cli}; the local service is not running`, color: t.blocked };
    else if (local?.installed) health = { text: "Managed LiteLLM installation found but not ready", color: t.blocked };
    else if (local?.cli) health = { text: `CLI found at ${local.cli}; managed installation is not usable`, color: t.blocked };
    else health = { text: "No managed LiteLLM CLI found", color: t.blocked };
  } else if (remote?.healthy) {
    health = remote.models.length
      ? { text: `Reachable · ${remote.models.length} models available`, color: t.done }
      : { text: "Reachable · no models advertised", color: t.done };
  } else {
    health = { text: remote?.error ?? (owner.litellmMode === "quickstart" ? "Quickstart has not been checked" : "Existing connection has not been checked"), color: remote ? t.blocked : t.muted };
  }
  const field = (id, label, state) => v_flex().w_full().gap(4)
    .child(div().text_size(10).font_semibold().text_color(t.dim).child(label))
    .child(h_flex().w_full().h(32).px(8).rounded(6).border_1().border_color(t.input).bg(t.background)
      .child(Input.new(state).flex_1().min_w(0).text_size(12).text_color(t.foreground).bg("#00000000")));
  const keyField = owner.litellmHasApiKey && !owner.litellmReplaceKey
    ? h_flex().w_full().items_center().gap(8)
      .child(div().flex_1().text_size(11).text_color(t.muted).child("API key saved securely"))
      .child(owner.button("am-litellm-replace-key", "Replace", t, (_event, cx) => {
        owner.litellmReplaceKey = true;
        cx.notify();
      }, { height: 24, px: 8, color: t.muted }))
    : field("am-litellm-api-key", "API KEY", owner.litellmApiKey);
  return v_flex()
    .id("am-litellm-card")
    .w_full()
    .p(12)
    .gap(10)
    .rounded(10)
    .border_1()
    .border_color(t.border)
    .bg(t.surface)
    .child(
      h_flex().w_full().items_center().gap(16)
        .child(v_flex().flex_1().min_w(0).gap(3)
          .child(h_flex().items_center().gap(6)
            .child(image("mods/orca-assets/litellm_favicon_light_32.png").w(16).h(16).rounded_full())
            .child(div().text_size(13).font_semibold().text_color(t.foreground).child("LiteLLM")))
          .child(div().text_size(11).line_height("16px").text_color(t.muted)
            .child("Managed records usage; existing checks health. Running sessions keep their current route.")))
        .child(div().id("am-litellm-toggle").w(36).h(20).flex_none().flex().items_center().p(2).rounded_full()
          .bg(on ? t.foreground : t.input)
          .when(owner.litellmBusy, el => el.opacity(0.45))
          .when(!owner.litellmBusy, el => el.cursor_pointer())
          .role("switch").checked(on)
          .accessibility_label("Enable LiteLLM for Model Provider launches")
          .tooltip(owner.litellmBusy ? "Saving…" : "Applies to new Model Provider launches")
          .when(!owner.litellmBusy, el => el.on_click((_event, cx) => owner.toggleLiteLLM(cx)))
          .child(h_flex().w_full().items_center().when(on, el => el.justify_end())
            .when(!on, el => el.justify_start())
            .child(div().size(16).rounded_full().bg(on ? t.background : t.muted)))),
    )
    .child(h_flex().gap(6)
      .child(owner.button("am-litellm-local", "Managed", t, (_event, cx) => owner.setLiteLLMMode("local", cx), { primary: owner.litellmMode === "local", disabled: owner.litellmBusy || owner.litellmEnabled }))
      .child(owner.button("am-litellm-quickstart", "Quickstart", t, (_event, cx) => owner.setLiteLLMMode("quickstart", cx), { primary: owner.litellmMode === "quickstart", disabled: owner.litellmBusy || owner.litellmEnabled }))
      .child(owner.button("am-litellm-remote", "Existing", t, (_event, cx) => owner.setLiteLLMMode("remote", cx), { primary: owner.litellmMode === "remote", disabled: owner.litellmBusy || owner.litellmEnabled })))
    .when(on, el => el.child(div().text_size(11).text_color(t.muted).child("Turn off LiteLLM to change mode.")))
    .when(on && owner.litellmMode === "local" && Boolean(local) && !local.usable, el => el.child(div().text_size(11).line_height("16px").text_color(t.blocked)
      .child("LiteLLM is on, but the managed gateway is not ready. New Model Provider launches will fail. If you use litellm-gateway, switch to Quickstart.")))
    .when(owner.litellmMode === "local", el => el.child(v_flex().gap(6)
      .child(div().text_size(11).text_color(health.color).child(health.text))
      .when(Boolean(local?.cli), inner => inner.child(div().min_w(0).truncate().text_size(10).text_color(t.dim).child(local.cli)))
      .when(Boolean(local) && !local.cli, inner => inner.child(div().text_size(10).line_height("15px").text_color(t.dim)
        .child("Managed mode uses Herdr's managed CLI, not Docker. Choose Quickstart for a running local server, or Existing for another one.")))
      .child(Link.new("am-litellm-repo").href("https://github.com/BerriAI/litellm")
        .text_size(11).text_color(t.accent).underline()
        .tooltip("Open the LiteLLM repository on GitHub")
        .child("LiteLLM on GitHub ↗"))
      .child(h_flex().items_center().gap(8)
        .child(owner.button("am-litellm-refresh", owner.litellmBusy ? "Checking…" : "Check local LiteLLM", t,
          (_event, cx) => owner.refreshLiteLLMStatus(cx), { height: 24, px: 8, color: t.muted, disabled: owner.litellmBusy }))
        .child(div().text_size(10).text_color(t.dim).child(timeLabel(owner.litellmCheckedAt))))))
    .when(owner.litellmMode === "quickstart", el => el.child(v_flex().w_full().gap(8)
      .child(div().text_size(10).line_height("15px").text_color(t.dim)
        .child("Uses the LiteLLM quickstart running on this Mac. Its address and key are read from its folder each time and are never saved here."))
      .child(div().text_size(11).text_color(health.color).child(health.text))
      .when(remote?.healthy && remote.models.length === 0, inner => inner.child(div().text_size(11).line_height("16px").text_color(t.blocked)
        .child(on ? "The quickstart is running but advertises no models. New Model Provider launches will fail until it returns one."
          : "The quickstart is running but advertises no models. Add one in its Admin UI before enabling LiteLLM.")))
      .when(Boolean(remote?.models?.length), inner => inner.child(div().text_size(10).line_height("15px").text_color(t.dim)
        .child(`Models: ${remote.models.slice(0, 5).join(", ")}${remote.models.length > 5 ? ", …" : ""}`)))
      .child(h_flex().items_center().gap(8)
        .child(owner.button("am-litellm-refresh", owner.litellmBusy ? "Checking…" : "Check quickstart", t,
          (_event, cx) => owner.refreshLiteLLMStatus(cx), { height: 24, px: 8, color: t.muted, disabled: owner.litellmBusy }))
        .child(div().text_size(10).text_color(t.dim).child(timeLabel(owner.litellmCheckedAt))))))
    .when(owner.litellmMode === "remote", el => el.child(v_flex().w_full().gap(8)
      .child(field("am-litellm-host", "API HOST", owner.litellmHost))
      .child(keyField)
      .child(div().text_size(10).text_color(t.dim).child("Use an inference-only LiteLLM API key where available."))
      .child(div().text_size(11).text_color(health.color).child(health.text))
      .when(remote?.healthy && remote.models.length === 0, inner => inner.child(div().text_size(11).line_height("16px").text_color(t.blocked)
        .child(on ? "The server is reachable, but advertises no models. New Model Provider launches will fail until it returns one."
          : "The server is reachable, but advertises no models. Add one before enabling LiteLLM.")))
      .when(Boolean(remote?.models?.length), inner => inner.child(div().text_size(10).line_height("15px").text_color(t.dim)
        .child(`Models: ${remote.models.slice(0, 5).join(", ")}${remote.models.length > 5 ? ", …" : ""}`)))
      .when(owner.litellmRemoteDirty, inner => inner.child(div().text_size(10).text_color(t.dim).child("Connection status is for the saved settings.")))
      .child(h_flex().items_center().gap(8)
        .child(owner.button("am-litellm-save-remote", owner.litellmBusy ? "Checking…" : "Save & check", t,
          (_event, cx) => owner.saveRemoteLiteLLM(cx), { height: 24, px: 8, primary: true, disabled: owner.litellmBusy }))
        .child(owner.button("am-litellm-refresh", owner.litellmBusy ? "Checking…" : "Check server", t,
          (_event, cx) => owner.refreshLiteLLMStatus(cx), { height: 24, px: 8, color: t.muted, disabled: owner.litellmBusy }))
        .child(div().text_size(10).text_color(t.dim).child(timeLabel(owner.litellmCheckedAt))))))
    .when(Boolean(owner.litellmError), el => el.child(div().text_size(11).text_color(t.blocked).child(owner.litellmError)));
}

function permissionTitleRow(owner, managed, permissions, t, compact) {
  // In the settings rail, the detail column may be only 280px wide.
  // Stack the trigger below the description rather than squeezing it to a word per line.
  const row = compact ? v_flex().w_full().gap(8) : h_flex().w_full().items_start().gap(16);
  return row
    .child(
      (compact ? v_flex().w_full() : v_flex().flex_1())
        .min_w(0)
        .gap(3)
        .child(div().text_size(13).font_semibold().text_color(t.foreground).child("Permissions"))
        .child(
          div()
            .text_size(11)
            .line_height("16px")
            .text_color(t.muted)
            .child("How much every agent may do without asking. Each agent can keep its own."),
        ),
    )
    .child(
      div()
        .when(compact, (el) => el.w_full().max_w(300))
        .child(permissionSelect(
          {
            id: "default",
            open: owner.permissionOpen === "default",
            active: owner.permissionActive,
            choice: permissions.default,
            label: PERMISSION_LABELS[permissions.default],
            warn: permissions.default === "full-access",
            width: compact ? 300 : 340,
            items: defaultPermissionItems(owner, managed),
            onOpenChange: (open, cx) => owner.setPermissionMenu("default", open, cx),
          },
          t,
        )),
    );
}

function permissionSummaryRow(owner, summary, permissions, t) {
  return h_flex()
    .w_full()
    .gap(10)
    .items_center()
    .flex_wrap()
    .child(
      v_flex()
        .flex_1()
        .min_w(180)
        .gap(2)
        .when(Boolean(summary.exceptionLine), (inner) =>
          inner.child(div().text_size(11).text_color(t.muted).child(summary.exceptionLine)),
        )
        .when(summary.custom > 0, (inner) => inner.child(div().text_size(11).text_color(t.dim).child(summary.customLine))),
    )
    .when(Boolean(summary.exceptionLine), (inner) =>
      inner.child(
        owner.button(
          "am-permission-use-default",
          permissions.default === "own" ? "Reset every agent to its own settings" : `Use ${PERMISSION_LABELS[permissions.default]} for all`,
          t,
          (_event, cx) => owner.setDefaultPermission(permissions.default, cx),
          { height: 24, px: 8 },
        ),
      ),
    );
}

function permissionNoticeRow(owner, t) {
  const notice = owner.permissionNotice;
  return h_flex()
    .w_full()
    .gap(10)
    .items_center()
    .child(
      div()
        .flex_1()
        .min_w(0)
        .text_size(11)
        .text_color(notice.tone === "blocked" ? t.blocked : t.muted)
        .child(notice.text),
    )
    .when(notice.retry, (inner) =>
      inner.child(
        owner.button("am-permission-retry", "Retry", t, (_event, cx) => {
          const retry = owner.permissionNotice?.retry;
          owner.permissionNotice = null;
          retry?.(cx);
        }, { height: 24, px: 8, color: t.blocked }),
      ),
    );
}

function refreshButton(owner, t) {
  const busy = owner.refreshing;
  return Button.new("am-refresh")
    .disabled(Boolean(busy))
    .h(30)
    .px(10)
    .gap(6)
    .flex_none()
    .items_center()
    .rounded(6)
    .border_1()
    .border_color(t.border)
    .bg("#00000000")
    .text_size(12)
    .font_medium()
    .text_color(busy ? t.dim : t.foreground)
    .when(!busy, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_event, cx) => owner.refresh(cx)))
    .role("button")
    .accessibility_label(busy ? "Refreshing agents" : "Refresh installed agents")
    .tooltip("Re-check every agent on this computer")
    .child(busy ? spinner(t, 12) : svg("mods/orca-assets/refresh-cw.svg").size(13).flex_none().text_color(t.muted))
    .child(busy ? "Refreshing…" : "Refresh");
}

// Reload from disk and Dismiss, shown while a dirty draft meets an outside programs.json change.
function conflictActions(owner, rows, t) {
  if (!owner.externalConflict || !owner.anyDirty()) return null;
  return h_flex()
    .gap(8)
    .child(owner.button("am-reload-all", "Reload from disk", t, (_event, cx) => owner.reloadAllFromDisk(rows, cx), { height: 24, px: 8 }))
    .child(
      owner.button("am-conflict-dismiss", "Dismiss", t, (_event, cx) => {
        owner.externalConflict = false;
        cx.notify();
      }, { height: 24, px: 8, color: t.muted }),
    );
}

// The note under a banner that explains what the page does meanwhile.
const bannerNote = (text, t) => div().text_size(11).text_color(t.blocked).child(text);

// The banners under the header, one for each thing wrong; the element comes back with them added.
function addBanners(el, owner, rows, t) {
  const actions = conflictActions(owner, rows, t);
  return el
    .when(owner.managerError, (inner) =>
      inner.child(
        banner(`agent-manager.json is invalid: ${owner.managerError}`, t, {
          actions: bannerNote("Agent settings switches are paused until the file is fixed.", t),
        }),
      ),
    )
    .when(owner.programsError, (inner) =>
      inner.child(
        banner(owner.programsError, t, {
          actions: bannerNote("Built-in commands are shown; editing is paused so valid JSON is not destroyed.", t),
        }),
      ),
    )
    .when(owner.detectionError, (inner) =>
      inner.child(
        banner(owner.detectionError, t, {
          actions: h_flex().gap(8).child(owner.button("am-retry-detection", "Retry", t, (_event, cx) => owner.refresh(cx), { height: 24, px: 8, color: t.blocked })),
        }),
      ),
    )
    .when(owner.freshWarning, (inner) =>
      inner.child(banner(owner.freshWarning, t, { border: t.blocked, bg: "#f59e0b14", color: t.blocked })),
    )
    .when(owner.writeError && !rows.some((row) => owner.editors.get(row.key)?.conflict), (inner) =>
      inner.child(banner(owner.writeError, t)),
    )
    .when(actions, (inner) =>
      inner.child(banner("programs.json changed on disk while you were editing. Your draft is kept.", t, { actions })),
    );
}

const INTRO =
  "Install status for the Agent CLIs Herdr can start. Uninstalled CLIs keep their switch unavailable; disabled installed agents stay installed but are hidden from the Start an agent menu. Install, uninstall, or edit a command when the CLI is outside PATH.";

function pageHeader(owner, rows, t, contentPad) {
  const header = v_flex()
    .w_full()
    .max_w(760)
    .mx_auto()
    .px(contentPad)
    .pt(20)
    .gap(2)
    .child(
      h_flex()
        .w_full()
        .items_center()
        .gap(8)
        .child(
          backButton(t, () => {
            owner.typing = false;
            owner.showTerminals();
          }),
        )
        .child(div().text_size(20).font_semibold().text_color(t.foreground).child("Agents"))
        .child(badge("This computer", t, { border: true }))
        .child(div().flex_1())
        .child(refreshButton(owner, t)),
    )
    .child(div().mt(4).text_size(12).line_height("18px").text_color(t.muted).child(INTRO));
  return addBanners(header, owner, rows, t);
}

function loadingRow(t) {
  return h_flex()
    .w_full()
    .gap(8)
    .p(16)
    .rounded(8)
    .border_1()
    .border_color(t.border)
    .border_dashed()
    .items_center()
    .child(spinner(t, 12))
    .child(div().text_size(12).text_color(t.muted).child("Detecting installed agents…"));
}

// The official catalog: Installed, then Available to install.
function addOfficialSections(el, owner, split, t) {
  return el
    .child(group("Official support", "Agents Herdr supports natively", t))
    .child(section("Installed", `${split.installed.length} detected`, t, owner.fromCache ? "showing last known result" : null))
    .when(split.installed.length === 0, (inner) =>
      inner.child(empty("No agents detected. If one is installed, the probe may have timed out — try Refresh.", t)),
    )
    .when(split.installed.length > 0, (inner) => inner.child(owner.catalog(split.installed, t, "installed")))
    .when(split.available.length > 0, (inner) =>
      inner
        .child(section("Available to install", `${split.available.length} agents`, t, null, true))
        .child(owner.catalog(split.available, t, "available")),
    )
    .when(split.available.length === 0 && split.installed.length > 0, (inner) =>
      inner.child(section("Available to install", "0 agents", t, "every supported agent is installed", true)),
    );
}

// FreeBuff is the one unofficial CLI: detected or offered, never managed.
function addUnofficialSections(el, owner, t) {
  const found = owner.freebuffInstalled;
  return el
    .child(group("Unofficial support", "Community CLIs Herdr does not manage; they start from the Start menu", t))
    .child(section("Installed", found ? "1 detected" : "0 detected", t))
    .when(found, (inner) => inner.child(owner.unofficialRow(t, true)))
    .when(!found, (inner) => inner.child(empty("No unofficial agents detected.", t)))
    .child(section("Available to install", found ? "0 agents" : "1 agent", t, null, true))
    .when(!found, (inner) => inner.child(owner.unofficialRow(t, false)));
}

function pageFooter(owner, t) {
  return h_flex()
    .w_full()
    .pt(16)
    .pb(4)
    .gap(12)
    .flex_wrap()
    .items_center()
    .child(div().text_size(11).text_color(t.dim).child(timeLabel(owner.lastChecked)))
    .child(div().flex_1())
    .child(div().text_size(11).text_color(t.dim).child("↑↓ select · Enter edit · Space toggle installed · R refresh"));
}

function addSections(el, owner, split, t) {
  const rows = split.all;
  const withPermissions = el.when(rows.some((row) => row.supports), (inner) => inner.child(owner.permissionsCard(rows, t)));
  const withOfficial = addOfficialSections(withPermissions, owner, split, t);
  return addUnofficialSections(withOfficial.child(div().w_full().h(1).mt(16).bg(t.border)), owner, t).child(pageFooter(owner, t));
}

function pageBody(owner, split, t, contentPad) {
  const loading = owner.loading && !owner.agents;
  return v_flex()
    .w_full()
    .max_w(760)
    .mx_auto()
    .px(contentPad)
    .pb(20)
    .gap(2)
    .when(loading, (el) => el.child(loadingRow(t)))
    .when(!loading, (el) => addSections(el, owner, split, t));
}

/** The whole Agents page: the header above a scrolling list of sections. */
export function agentsPageView(owner, t) {
  const split = owner.allRows();
  const contentPad = (owner.width || 800) < NARROW_WIDTH ? 12 : 24;
  const header = pageHeader(owner, split.all, t, contentPad);
  const body = pageBody(owner, split, t, contentPad);
  return v_flex()
    .id("am-root")
    .track_focus(owner.handle)
    .size_full()
    .min_h(0)
    .overflow_hidden()
    .bg(t.background)
    .text_size(12)
    .on_key_down((event, cx) => owner.onKey(event, cx))
    .on_size_change((size, cx) => {
      if (owner.width !== size.width) {
        owner.width = size.width;
        cx.notify();
      }
    })
    .child(header.flex_none())
    .child(v_flex().id("am-list").w_full().min_h(0).overflow_y_scrollbar().flex_1().child(body));
}

// Settings route uses the existing native refresh and conflict controls.
function sidebarNode(node) {
  if (node?.id === "left-sidebar") return node;
  for (const child of node?.children ?? []) {
    const found = sidebarNode(child);
    if (found) return found;
  }
  return null;
}

// eslint-disable-next-line complexity -- shortcut: this function's branches are inherited from main, refactor when this area is next changed
export function settingsPageView(owner, t, cx) {
  const rows = railRows(owner.allRows().all);
  const unofficial = owner.unofficialRows();
  const providersSelected = owner.railSelection === "providers";
  const anchor = shared("left-sidebar.settingsAnchor");
  const zoom = settings()?.zoom || 1;
  const sidebar = anchor ? sidebarNode(layout()) : null;
  const currentLeft = sidebar?.hidden ? 0 : (sidebar?.size?.px ?? anchor?.left);
  const pad = (anchor ? anchor.width / zoom : owner.width || 800) < NARROW_WIDTH ? 12 : 24;
  const header = addBanners(v_flex().w_full().max_w(760).mx_auto().px(pad).pt(20).gap(2)
    .child(h_flex().w_full().items_center().gap(8).child(div().flex_1()).child(badge("This computer", t, { border: true }))
      .when(!providersSelected, el => el.child(refreshButton(owner, t)))), owner, rows, t);
  const loading = !providersSelected && owner.loading && !owner.agents;
  const selected = [...rows, ...unofficial].find(row => row.key === owner.railSelection);
  const body = v_flex().w_full().max_w(760).mx_auto().px(pad).pb(20).gap(2)
    .when(loading, el => el.child(loadingRow(t)))
    .when(!loading && providersSelected, el => el
      .child(div().text_size(18).font_semibold().text_color(t.foreground).child("Model providers"))
      .child(div().mt(4).text_size(12).line_height("18px").text_color(t.muted).child("Configure the model sources shared by supported agents."))
      .child(owner.modelProvidersCard(t)))
    .when(!loading && owner.railSelection === "global", el => el.child(div().text_size(18).font_semibold().text_color(t.foreground).child("Global Agent Settings"))
      .child(div().mt(4).text_size(12).line_height("18px").text_color(t.muted)
        .child("Defaults for every agent on this computer. Changes apply to new launches."))
      .child(group("Agent launch arguments", "Defaults Herdr applies when it launches an agent command.", t))
      .child(v_flex().w_full().gap(8)
        .when(rows.some(row => row.supports), inner => inner.child(permissionsCardView(owner, rows, t, true)))
        .child(environmentCardView(owner, t)))
      .child(group("Global model providers", "Routing for new Model Provider launches. Official and unofficial agents are unaffected.", t))
      .child(gatewayCardView(owner, t)))
    .when(!loading && !providersSelected && owner.railSelection !== "global", el => el.child(selected ? owner.agentDetail(selected, t, cx) : empty("Agent unavailable on this computer. Refresh or select another agent.", t)))
    .when(!providersSelected, el => el.child(div().pt(12).text_size(11).text_color(t.dim).child(timeLabel(owner.lastChecked))));
  return v_flex().id("am-root").size_full().min_h(0).overflow_hidden().bg(t.background).text_size(12)
    .on_key_down((event, keyCx) => { if (owner.permissionOpen && owner.onPermissionKey(String(event.key ?? ""), keyCx)) keyCx.stop_propagation(); })
    .on_size_change((size, sizeCx) => {
      const wasNarrow = (owner.width || 800) < NARROW_WIDTH;
      owner.width = size.width;
      if (!anchor && wasNarrow !== (size.width < NARROW_WIDTH)) sizeCx.notify();
    })
    // The agent list lives in the left sidebar (orca-sidebar-projects). Its keys go to this childless element,
    // as they did to the rail, so a key typed in a field or on a button below never selects or toggles an agent.
    .child(div().id("am-keys").size(0).flex_none().track_focus(owner.handle).on_key_down((event, keyCx) => { if (owner.onKey(event, keyCx)) keyCx.stop_propagation(); }))
    .child(v_flex().id("am-list").w_full().min_w(0).min_h(0).overflow_y_scrollbar().flex_1()
      .when(anchor, el => el.w(anchor.width / zoom).relative().left((anchor.left - currentLeft) / zoom))
      .child(header).child(body));
}
