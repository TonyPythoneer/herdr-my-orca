// CodeBurn in Herdr: the desktop app's spend, session, model, optimize and plan
// views, driven by the local CodeBurn CLI's JSON output. The engine never
// leaves this computer; the panel only starts it when it is shown and keeps
// the last answer for a couple of minutes.
import { View, div } from "gpui-kit";
import { h_flex, v_flex, InputState } from "gpui-base";
import { checking, exec, home, props, run, theme } from "herdr";
import {
  PERIODS,
  TAB_KEYS,
  TAB_LABELS,
  brand,
  periodByKey,
  dailySeries,
  extractJson,
  parseEngineVersion,
  relativeTime,
} from "./data.js";
import {
  brandMark,
  button,
  card,
  icon,
  iconButton,
  mono,
  pill,
  segmented,
  skeleton,
} from "./parts.js";
import {
  modelsView,
  optimizeView,
  overviewView,
  plansView,
  sessionsView,
} from "./views.js";

const ENGINE_SCRIPT = `
for c in "$HOME/.cache/herdr-codeburn/node_modules/.bin/codeburn" \\
         "$HOME/.local/bin/codeburn" \\
         "/opt/homebrew/bin/codeburn" \\
         "/usr/local/bin/codeburn" \\
         "$HOME/.npm-global/bin/codeburn" \\
         "$HOME/.bun/bin/codeburn" \\
         "$HOME/.volta/bin/codeburn" \\
         "$HOME/.asdf/shims/codeburn" \\
         "$HOME/.local/share/mise/shims/codeburn" \\
         "$HOME/.local/share/pnpm/codeburn"; do
  if [ -x "$c" ]; then printf '%s\\n' "$c"; exit 0; fi
done
for c in "$HOME"/.nvm/versions/node/*/bin/codeburn; do
  if [ -x "$c" ]; then printf '%s\\n' "$c"; exit 0; fi
done
p=$(command -v codeburn 2>/dev/null || true)
if [ -n "$p" ]; then printf '%s\\n' "$p"; exit 0; fi
if [ -x "$HOME/.cache/herdr-codeburn/node_modules/codeburn/dist/cli.js" ]; then
  printf '%s\\n' "$HOME/.cache/herdr-codeburn/node_modules/codeburn/dist/cli.js"
  exit 0
fi
exit 1
`;

const INSTALL_SCRIPT = `
set -e
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$HOME/.npm-global/bin:$HOME/.bun/bin:$PATH"
if ! command -v npm >/dev/null 2>&1; then
  echo "npm was not found. Install Node 22.15 or newer from https://nodejs.org, then try again." >&2
  exit 127
fi
mkdir -p "$HOME/.cache/herdr-codeburn"
cd "$HOME/.cache/herdr-codeburn"
npm install --no-audit --no-fund --silent "codeburn@^0.9.0"
`;

const WINDOWS_INSTALL = `
$ErrorActionPreference = 'Stop'
$env:Path = "$env:APPDATA\npm;$env:ProgramFiles\nodejs;$env:Path"
$dir = Join-Path $env:USERPROFILE '.cache\\herdr-codeburn'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
Set-Location $dir
npm install --no-audit --no-fund --silent "codeburn@^0.9.0"
`;

const CACHE_MS = 2 * 60 * 1000;
const AUTO_MS = 5 * 60 * 1000;
const AGENTS_PAGE = "main-agents";

function tail(text, max = 2000) {
  const value = String(text ?? "").trim();
  if (value.length <= max) return value;
  return value.slice(value.length - max);
}

function shortPath(path) {
  const value = String(path ?? "");
  const h = home();
  return h && value.startsWith(h) ? `~${value.slice(h.length)}` : value;
}

export default class CodeBurn extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.width = 0;
    this.tab = TAB_KEYS.includes(props()?.tab) ? props().tab : "overview";
    this.period = "week";
    this.engine = null;
    this.engineChecked = false;
    this.engineError = null;
    this.nodeVersion = null;
    this.install = null;
    this.data = {};
    this.cache = new Map();
    this.loading = true;
    this.refreshing = false;
    this.pendingRefresh = false;
    this.gen = 0;
    this.lastRefresh = null;
    this.error = null;
    this.expanded = new Set();
    this.expandedModel = null;
    this.findings = new Set();
    this.sessionLimit = 50;
    this.copied = null;
    this.typing = false;
    this.search = InputState.new({ placeholder: "Search sessions, projects, models" });
    this.search.on("change", (_event, cx) => {
      this.sessionLimit = 50;
      cx.notify();
    });
    this.search.on("focus", (_event, cx) => {
      this.typing = true;
      cx.notify();
    });
    this.search.on("blur", (_event, cx) => {
      this.typing = false;
      cx.notify();
    });
    this.search.on("submit", (_event, cx) => {
      this.typing = false;
      this.handle.focus();
      cx.notify();
    });

    cx.timer.every(AUTO_MS, (cx) => {
      if (!this.typing && this.engine && !this.refreshing) this.refresh(cx, { silent: true });
    });
    if (checking()) {
      // If this pane was restored during app startup, probe once the window is
      // ready instead of leaving the panel on its loading skeleton forever.
      cx.timer.after(800, (cx) => {
        if (!this.engineChecked) this.resolveEngine(cx);
      });
      return;
    }
    this.handle.focus();
    this.resolveEngine(cx);
  }

  // ---- engine ---------------------------------------------------------------

  resolveEngine(cx) {
    cx.spawn(async (cx) => {
      let path = null;
      let detail = null;
      const node = await exec("node", ["--version"], { timeout: 10000 }).catch(() => null);
      this.nodeVersion = node?.code === 0 ? node.stdout.trim() : null;
      try {
        const found = await exec("sh", ["-c", ENGINE_SCRIPT], { timeout: 20000 });
        if (found.code === 0) {
          path =
            found.stdout
              .split("\n")
              .map((line) => line.trim())
              .find(Boolean) ?? null;
        } else {
          detail = tail(found.stderr) || null;
        }
      } catch (error) {
        detail = String(error?.message ?? error);
      }

      // A Windows install has no sh on PATH; the direct command is the shortest
      // probe and covers CodeBurn installed through npm's normal prefix.
      if (!path) {
        const direct = await exec("codeburn", ["--version"], { timeout: 20000 }).catch(() => null);
        if (direct?.code === 0) path = "codeburn";
      }

      if (path) {
        let version = null;
        try {
          const result = await exec(path, ["--version"], { timeout: 20000 });
          if (result.code === 0) version = parseEngineVersion(result.stdout);
          else {
            detail = tail(result.stderr || result.stdout) || null;
            path = null;
          }
        } catch (error) {
          detail = String(error?.message ?? error);
          path = null;
        }
        if (path) {
          this.engine = { path, version };
          this.engineChecked = true;
          this.engineError = null;
          this.install = null;
          this.refresh(cx, { force: true });
          return;
        }
      }

      this.engine = null;
      this.engineChecked = true;
      this.engineError = detail;
      this.loading = false;
      this.refreshing = false;
      cx.notify();
    });
  }

  installEngine(cx) {
    if (this.install?.phase === "installing") return;
    this.install = { phase: "installing", message: "Installing CodeBurn…" };
    this.engineError = null;
    cx.notify();
    cx.spawn(async (cx) => {
      let result = null;
      try {
        result = await exec("sh", ["-c", INSTALL_SCRIPT], { timeout: 600000 });
      } catch (error) {
        try {
          result = await exec("powershell", ["-NoProfile", "-Command", WINDOWS_INSTALL], { timeout: 600000 });
        } catch (second) {
          result = { code: 127, stdout: "", stderr: String(second?.message ?? second) };
        }
      }
      if (result.code === 0) {
        this.install = { phase: "done", message: "CodeBurn installed." };
        this.engineChecked = false;
        this.engine = null;
        this.resolveEngine(cx);
      } else {
        this.install = {
          phase: "error",
          message: tail(result.stderr || result.stdout) || `npm exited ${result.code}`,
        };
      }
      cx.notify();
    });
  }

  async runEngine(args, timeout = 180000) {
    if (!this.engine?.path) return { code: 127, stdout: "", stderr: "CodeBurn is not installed." };
    try {
      return await exec(this.engine.path, args, { timeout });
    } catch (error) {
      try {
        return await exec("sh", ["-c", 'exec "$0" "$@"', this.engine.path, ...args], { timeout });
      } catch (second) {
        return { code: 127, stdout: "", stderr: String(second?.message ?? second) };
      }
    }
  }

  async runJson(args, timeout) {
    const result = await this.runEngine(args, timeout);
    const data = extractJson(result.stdout);
    if (data === null) {
      return {
        ok: false,
        error: {
          message: `CodeBurn ${args[0]} did not return JSON.`,
          detail: tail(result.stderr || result.stdout),
          code: result.code,
        },
      };
    }
    return { ok: true, data };
  }

  // ---- loading --------------------------------------------------------------

  cacheKey() {
    return this.tab === "plans" ? "plans" : `${this.tab}:${this.period}`;
  }

  hasData() {
    if (!this.data) return false;
    if (this.tab === "overview") return Boolean(this.data.report);
    if (this.tab === "sessions") return Array.isArray(this.data.sessions);
    if (this.tab === "models") return Array.isArray(this.data.models);
    if (this.tab === "optimize") return Boolean(this.data.optimize);
    return Boolean(this.data.quota);
  }

  hydrateFromCache() {
    const cached = this.cache.get(this.cacheKey());
    if (!cached) return false;
    this.data = cached.data;
    this.lastRefresh = cached.at;
    this.loading = false;
    return true;
  }

  refresh(cx, options = {}) {
    if (this.refreshing) {
      this.pendingRefresh = true;
      return;
    }
    if (!this.engine) {
      if (!this.engineChecked) this.resolveEngine(cx);
      return;
    }
    const key = this.cacheKey();
    const cached = this.cache.get(key);
    if (!options.force && cached && Date.now() - cached.at < CACHE_MS) {
      this.data = cached.data;
      this.lastRefresh = cached.at;
      this.loading = false;
      this.error = null;
      cx.notify();
      return;
    }

    const gen = ++this.gen;
    this.refreshing = true;
    this.error = null;
    if (!this.hasData()) this.loading = true;
    cx.notify();
    cx.spawn(async (cx) => {
      let next = null;
      let failure = null;
      try {
        next = await this.load();
        if (next?.error) {
          failure = next.error;
          next = null;
        }
      } catch (error) {
        failure = { message: "CodeBurn could not be read.", detail: String(error?.message ?? error) };
      }
      // A tab or period switch while the engine was working owns the next
      // answer; this one would paint the wrong page if it landed.
      if (gen !== this.gen) {
        this.refreshing = false;
        if (this.pendingRefresh) {
          this.pendingRefresh = false;
          this.refresh(cx, { force: true });
        }
        return;
      }
      if (failure) {
        this.error = failure;
        if (!this.hasData()) this.data = {};
      } else if (next) {
        this.data = next;
        this.cache.set(key, { at: Date.now(), data: next });
        this.lastRefresh = Date.now();
        this.error = null;
      }
      this.loading = false;
      this.refreshing = false;
      if (this.pendingRefresh) {
        this.pendingRefresh = false;
        this.refresh(cx, { force: true });
      } else {
        cx.notify();
      }
    });
  }

  async load() {
    if (this.tab === "overview") {
      const [report, models, quota, status] = await Promise.all([
        this.runJson(["report", "--format", "json", "--period", this.period]),
        this.runJson(["models", "--format", "json", "--period", this.period]),
        this.runJson(["quota", "--format", "json"], 90000),
        this.runJson(["status", "--format", "json"], 90000),
      ]);
      if (!report.ok) return { error: report.error };
      return {
        report: report.data,
        models: models.ok ? models.data : [],
        quota: quota.ok ? quota.data : null,
        status: status.ok ? status.data : null,
      };
    }
    if (this.tab === "sessions") {
      const sessions = await this.runJson(["sessions", "--format", "json", "--period", this.period], 240000);
      return sessions.ok ? { sessions: sessions.data } : { error: sessions.error };
    }
    if (this.tab === "models") {
      const [models, report] = await Promise.all([
        this.runJson(["models", "--format", "json", "--period", this.period], 240000),
        this.runJson(["report", "--format", "json", "--period", this.period], 240000),
      ]);
      if (!models.ok) return { error: models.error };
      return { models: models.data, report: report.ok ? report.data : null };
    }
    if (this.tab === "optimize") {
      const optimize = await this.runJson(["optimize", "--format", "json", "--period", this.period], 240000);
      return optimize.ok ? { optimize: optimize.data } : { error: optimize.error };
    }
    const quota = await this.runJson(["quota", "--format", "json"], 120000);
    return quota.ok ? { quota: quota.data } : { error: quota.error };
  }

  // ---- navigation -----------------------------------------------------------

  backToAgents(cx) {
    this.typing = false;
    this.handle.focus();
    run("layout.select", { stack: "main", child: AGENTS_PAGE });
  }

  openTab(tab, cx) {
    if (!TAB_KEYS.includes(tab)) return;
    this.tab = tab;
    this.gen++;
    this.typing = false;
    this.error = null;
    if (!this.hydrateFromCache()) {
      this.data = {};
      this.loading = true;
    }
    this.handle.focus();
    if (cx) this.refresh(cx);
  }

  switchPeriod(period, cx) {
    if (this.period === period) return;
    this.period = period;
    this.gen++;
    this.error = null;
    if (!this.hydrateFromCache()) {
      this.data = {};
      this.loading = true;
    }
    if (cx) this.refresh(cx);
    else this.loading = true;
  }

  openSession(sessionId, cx) {
    this.search.set_value("");
    this.expanded.clear();
    this.expanded.add(sessionId);
    this.sessionLimit = Math.max(50, this.sessionLimit);
    this.openTab("sessions", cx);
  }

  toggleSession(sessionId, cx) {
    if (this.expanded.has(sessionId)) this.expanded.delete(sessionId);
    else this.expanded.add(sessionId);
    cx.notify();
  }

  toggleModel(name, cx) {
    this.expandedModel = this.expandedModel === name ? null : name;
    cx.notify();
  }

  copy(key, cx, text) {
    cx.write_to_clipboard(String(text ?? key));
    this.copied = key;
    cx.notify();
    cx.timer.after(1600, () => {
      if (this.copied === key) {
        this.copied = null;
        cx.notify();
      }
    });
  }

  copyAllFixes(findings, cx) {
    const text = findings
      .filter((finding) => finding.fix?.text)
      .map((finding) => `# ${finding.title}\n${finding.fix.text}`)
      .join("\n\n");
    if (!text) return;
    this.copy("fix:all", cx, text);
  }

  openDocs(cx) {
    cx.open_url("https://github.com/getagentseal/codeburn");
  }

  // ---- helpers used by the views -------------------------------------------

  periodLabel() {
    return periodByKey(this.period).label;
  }

  series(report) {
    return dailySeries(report, this.period, new Date());
  }

  // ---- keyboard -------------------------------------------------------------

  onKey(event, cx) {
    if (this.typing) return false;
    const key = String(event.key ?? "");
    if (key === "escape") {
      this.backToAgents(cx);
      return true;
    }
    if (key.toLowerCase() === "r") {
      this.refresh(cx, { force: true });
      return true;
    }
    if (this.tab === "sessions" && (key === "/" || key === "?")) {
      this.search.focus();
      return true;
    }
    if (key.toLowerCase() === "p") {
      const index = PERIODS.findIndex((period) => period.key === this.period);
      this.switchPeriod(PERIODS[(index + 1) % PERIODS.length].key, cx);
      return true;
    }
    const index = Number(key);
    if (Number.isInteger(index) && index >= 1 && index <= TAB_KEYS.length) {
      this.openTab(TAB_KEYS[index - 1], cx);
      return true;
    }
    return false;
  }

  // ---- drawing --------------------------------------------------------------

  headerView(t, contentPad, narrow) {
    const tabs = segmented(
      TAB_KEYS.map((key) => ({ key, label: TAB_LABELS[key] })),
      this.tab,
      t,
      (key, cx) => this.openTab(key, cx),
      { id: "cb-tab", height: 26, px: 10, size: 11 },
    );
    const periods = segmented(
      PERIODS.map((period) => ({ key: period.key, label: period.short })),
      this.period,
      t,
      (key, cx) => this.switchPeriod(key, cx),
      { id: "cb-period", height: 26, px: 9, size: 10 },
    );

    return v_flex()
      .w_full()
      .flex_none()
      .border_b(1)
      .border_color(t.border)
      .bg(t.surface)
      .child(
        h_flex()
          .w_full()
          .items_center()
          .gap(9)
          .px(contentPad)
          .pt(12)
          .pb(9)
          .child(
            iconButton("cb-back", "arrow-left", "Back to Agent Settings", t, (_e, cx) => this.backToAgents(cx), {
              size: 28,
              iconSize: 15,
            }),
          )
          .child(brandMark(30))
          .child(
            v_flex()
              .flex_1()
              .min_w(0)
              .gap(1)
              .child(
                h_flex()
                  .items_center()
                  .gap(8)
                  .child(div().text_size(16).font_semibold().text_color(t.foreground).child("CodeBurn"))
                  .when(this.engine?.version, (el) =>
                    el.child(pill(`v${this.engine.version}`, t, { size: 9, height: 17, color: t.muted })),
                  )
                  .when(this.refreshing, (el) =>
                    el.child(div().text_size(10).text_color(t.muted).frames(["◐", "◓", "◑", "◒"], 120)),
                  ),
              )
              .when(!narrow, (el) =>
                el.child(
                  div()
                    .text_size(10)
                    .text_color(t.dim)
                    .child("Where your AI spend goes · every number read locally"),
                ),
              ),
          )
          .child(
            h_flex()
              .items_center()
              .gap(6)
              .when(this.lastRefresh, (el) =>
                el.child(
                  div()
                    .text_size(10)
                    .text_color(t.dim)
                    .child(this.refreshing ? "Refreshing…" : `Updated ${relativeTime(this.lastRefresh)}`),
                ),
              )
              .child(
                iconButton("cb-open-docs", "external-link", "Open the CodeBurn project", t, (_e, cx) => this.openDocs(cx), {
                  size: 28,
                  iconSize: 13,
                }),
              )
              .child(
                iconButton("cb-refresh", "refresh-cw", "Refresh CodeBurn data", t, (_e, cx) => this.refresh(cx, { force: true }), {
                  size: 28,
                  iconSize: 14,
                  disabled: this.refreshing || !this.engine,
                  color: this.refreshing ? t.accent : t.muted,
                }),
              ),
          ),
      )
      .child(
        h_flex()
          .w_full()
          .items_center()
          .gap(10)
          .flex_wrap()
          .px(contentPad)
          .pb(9)
          .child(tabs)
          .child(div().flex_1())
          .when(this.tab !== "plans", (el) => el.child(periods)),
      );
  }

  setupView(t, contentPad) {
    const installing = this.install?.phase === "installing";
    const installFailed = this.install?.phase === "error";
    return v_flex()
      .w_full()
      .max_w(720)
      .mx_auto()
      .px(contentPad)
      .py(28)
      .gap(16)
      .child(
        card(
          [
            h_flex()
              .w_full()
              .items_center()
              .gap(13)
              .child(brandMark(46))
              .child(
                v_flex()
                  .flex_1()
                  .min_w(0)
                  .gap(3)
                  .child(div().text_size(20).font_semibold().text_color(t.foreground).child("See where your AI spend goes"))
                  .child(
                    div()
                      .text_size(12)
                      .line_height("18px")
                      .text_color(t.muted)
                      .child(
                        "CodeBurn reads the session files your agent CLIs already write, prices every token, and breaks the bill down by tool, model, project and task. No account, no upload: Herdr runs the engine on this computer.",
                      ),
                  ),
              ),
            v_flex()
              .w_full()
              .gap(10)
              .pt(4)
              .children(
                [
                  ["Real cost, not guesses", "Every provider CodeBurn supports, priced from its own session files."],
                  ["Five views, one keystroke", "Spend, sessions, models, token-waste fixes and live plan limits."],
                  ["Local by design", "The engine, the database and the reports stay on this machine."],
                ].map(([title, body]) =>
                  h_flex()
                    .w_full()
                    .items_start()
                    .gap(9)
                    .child(
                      div()
                        .mt(1)
                        .size(17)
                        .flex_none()
                        .flex()
                        .items_center()
                        .justify_center()
                        .rounded_full()
                        .bg(`${brand()}1f`)
                        .child(icon("check", 10, brand())),
                    )
                    .child(
                      v_flex()
                        .flex_1()
                        .min_w(0)
                        .gap(1)
                        .child(div().text_size(11).font_semibold().text_color(t.foreground).child(title))
                        .child(div().text_size(10).text_color(t.muted).child(body)),
                    ),
                ),
              ),
            installing
              ? h_flex()
                  .w_full()
                  .items_center()
                  .gap(8)
                  .p(11)
                  .rounded(8)
                  .border_1()
                  .border_color(t.border)
                  .bg(t.background)
                  .child(div().text_size(12).text_color(t.accent).frames(["◐", "◓", "◑", "◒"], 120))
                  .child(
                    v_flex()
                      .flex_1()
                      .min_w(0)
                      .gap(2)
                      .child(div().text_size(11).font_medium().text_color(t.foreground).child("Installing CodeBurn…"))
                      .child(div().text_size(10).text_color(t.muted).child("One download into ~/.cache/herdr-codeburn. This can take a minute.")),
                  )
              : h_flex()
                  .w_full()
                  .items_center()
                  .gap(8)
                  .flex_wrap()
                  .child(
                    button("cb-install", installFailed ? "Try install again" : "Install CodeBurn", t, (_e, cx) => this.installEngine(cx), {
                      height: 32,
                      px: 14,
                      primary: true,
                    }),
                  )
                  .child(
                    button("cb-recheck", "Check again", t, (_e, cx) => {
                      this.engineChecked = false;
                      this.loading = true;
                      this.resolveEngine(cx);
                    }, { height: 32, px: 12, color: t.muted }),
                  )
                  .child(div().flex_1())
                  .child(
                    h_flex()
                      .id("cb-install-docs")
                      .items_center()
                      .gap(5)
                      .cursor_pointer()
                      .text_size(11)
                      .text_color(t.accent)
                      .hover((s) => s.underline())
                      .on_click((_e, cx) => this.openDocs(cx))
                      .child("Read how CodeBurn works")
                      .child(icon("external-link", 11, t.accent)),
                  ),
            div()
              .text_size(10)
              .line_height("16px")
              .text_color(t.dim)
              .child(
                this.nodeVersion
                  ? `Requires Node 22.15 or newer · ${this.nodeVersion} detected. The install command is npm install --prefix ~/.cache/herdr-codeburn "codeburn@^0.9.0".`
                  : 'Requires Node 22.15 or newer and npm. The install command is npm install --prefix ~/.cache/herdr-codeburn "codeburn@^0.9.0".',
              ),
            installFailed
              ? v_flex()
                  .w_full()
                  .gap(7)
                  .p(11)
                  .rounded(8)
                  .border_1()
                  .border_color(t.blocked)
                  .bg("#ef444414")
                  .child(div().text_size(11).font_medium().text_color(t.blocked).child("The install did not finish."))
                  .child(div().font_family(mono()).text_size(10).line_height("15px").text_color(t.muted).child(this.install.message))
                  .child(
                    button("cb-install-copy", "Copy the install command", t, (_e, cx) =>
                      this.copy(
                        "install",
                        cx,
                        'npm install --prefix ~/.cache/herdr-codeburn --no-audit --no-fund "codeburn@^0.9.0"',
                      ), {
                        height: 26,
                        px: 9,
                        size: 10,
                        color: t.muted,
                      }),
                  )
              : null,
            this.engineError
              ? div().text_size(10).font_family(mono()).text_color(t.dim).child(tail(this.engineError, 600))
              : null,
          ].filter(Boolean),
          t,
          { p: 22, gap: 16, shadow: true },
        ),
      );
  }

  errorView(t, contentPad) {
    const detail = this.error?.detail;
    return v_flex()
      .w_full()
      .max_w(760)
      .mx_auto()
      .px(contentPad)
      .py(24)
      .gap(12)
      .child(
        card(
          [
            h_flex()
              .w_full()
              .items_start()
              .gap(11)
              .child(
                div()
                  .size(34)
                  .flex_none()
                  .flex()
                  .items_center()
                  .justify_center()
                  .rounded(9)
                  .bg("#ef44441f")
                  .child(icon("alert-triangle", 17, t.blocked)),
              )
              .child(
                v_flex()
                  .flex_1()
                  .min_w(0)
                  .gap(3)
                  .child(div().text_size(14).font_semibold().text_color(t.foreground).child(this.error?.message ?? "CodeBurn could not be read."))
                  .child(
                    div()
                      .text_size(11)
                      .line_height("17px")
                      .text_color(t.muted)
                      .child("The engine is installed but the command did not finish cleanly. Your session files are untouched; try again, and check the detail below if it keeps happening."),
                  ),
              ),
            detail
              ? v_flex()
                  .w_full()
                  .gap(5)
                  .p(10)
                  .rounded(7)
                  .border_1()
                  .border_color(t.border)
                  .bg(t.background)
                  .child(div().text_size(9).font_semibold().text_color(t.dim).child("DETAIL"))
                  .child(
                    div()
                      .w_full()
                      .max_h(150)
                      .overflow_y_scrollbar()
                      .font_family(mono())
                      .text_size(10)
                      .line_height("15px")
                      .text_color(t.muted)
                      .child(detail),
                  )
              : null,
            h_flex()
              .w_full()
              .items_center()
              .gap(8)
              .flex_wrap()
              .child(button("cb-error-retry", "Try again", t, (_e, cx) => this.refresh(cx, { force: true }), { height: 30, px: 12, primary: true }))
              .when(detail, (el) =>
                el.child(
                  button("cb-error-copy", "Copy details", t, (_e, cx) => this.copy("error", cx, `${this.error?.message}\n\n${detail}`), {
                    height: 30,
                    px: 10,
                    color: t.muted,
                  }),
                ),
              )
              .child(div().flex_1())
              .child(
                button("cb-error-docs", "Open CodeBurn docs", t, (_e, cx) => this.openDocs(cx), {
                  height: 30,
                  px: 10,
                  color: t.muted,
                }),
              ),
            this.engine?.path
              ? div().text_size(9).font_family(mono()).text_color(t.dim).child(shortPath(this.engine.path))
              : null,
          ].filter(Boolean),
          t,
          { p: 18, gap: 14 },
        ),
      );
  }

  loadingView(t, contentPad) {
    return v_flex()
      .w_full()
      .max_w(1120)
      .mx_auto()
      .px(contentPad)
      .py(24)
      .gap(12)
      .child(
        h_flex()
          .w_full()
          .gap(12)
          .children(
            [0, 1, 2, 3].map(() =>
              div()
                .flex_1()
                .min_w(0)
                .child(
                  card(
                    [skeleton(t, { width: "38%", height: 10 }), skeleton(t, { width: "72%", height: 26 }), skeleton(t, { width: "58%", height: 10 })],
                    t,
                    { p: 14, gap: 9 },
                  ),
                ),
            ),
          ),
      )
      .child(card([skeleton(t, { width: "32%", height: 14 }), skeleton(t, { height: 150 })], t, { p: 16, gap: 12 }))
      .child(
        h_flex()
          .w_full()
          .gap(12)
          .child(
            div()
              .flex_1()
              .min_w(0)
              .child(
                card(
                  [skeleton(t, { width: "40%", height: 14 }), ...Array.from({ length: 4 }, () => skeleton(t, { height: 22 }))],
                  t,
                  { p: 16 },
                ),
              ),
          )
          .child(
            div()
              .flex_1()
              .min_w(0)
              .child(
                card(
                  [skeleton(t, { width: "40%", height: 14 }), ...Array.from({ length: 4 }, () => skeleton(t, { height: 22 }))],
                  t,
                  { p: 16 },
                ),
              ),
          ),
      );
  }

  body(t, contentPad) {
    if (!this.engineChecked) return this.loadingView(t, contentPad);
    if (!this.engine) return this.setupView(t, contentPad);
    if (this.error && !this.hasData()) return this.errorView(t, contentPad);
    if (this.loading && !this.hasData()) {
      if (this.tab === "sessions" || this.tab === "models" || this.tab === "optimize" || this.tab === "plans") {
        return v_flex()
          .w_full()
          .max_w(1120)
          .mx_auto()
          .px(contentPad)
          .py(24)
          .gap(12)
          .child(
            card(
              [skeleton(t, { width: "35%", height: 14 }), ...Array.from({ length: 6 }, () => skeleton(t, { height: 26 }))],
              t,
              { p: 16, gap: 10 },
            ),
          );
      }
      return this.loadingView(t, contentPad);
    }
    const view =
      this.tab === "sessions"
        ? sessionsView(this, t, this.data)
        : this.tab === "models"
          ? modelsView(this, t, this.data)
          : this.tab === "optimize"
            ? optimizeView(this, t, this.data)
            : this.tab === "plans"
              ? plansView(this, t, this.data)
              : overviewView(this, t, this.data);
    return v_flex()
      .w_full()
      .max_w(1120)
      .mx_auto()
      .px(contentPad)
      .pt(16)
      .pb(26)
      .gap(12)
      .when(this.error, (el) =>
        el.child(
          h_flex()
            .w_full()
            .items_center()
            .gap(8)
            .p(9)
            .rounded(8)
            .border_1()
            .border_color(t.border)
            .bg("#f59e0b14")
            .child(icon("alert-triangle", 13, t.blocked))
            .child(div().flex_1().text_size(11).text_color(t.muted).child(this.error.message))
            .child(button("cb-stale-retry", "Retry", t, (_e, cx) => this.refresh(cx, { force: true }), { height: 24, px: 8, size: 10, color: t.muted })),
        ),
      )
      .child(view);
  }

  render(cx) {
    const t = theme();
    const contentPad = (this.width || 900) < 560 ? 12 : 22;
    const narrow = (this.width || 900) < 700;
    return v_flex()
      .id("cb-root")
      .track_focus(this.handle)
      .size_full()
      .min_h(0)
      .overflow_hidden()
      .bg(t.background)
      .text_size(12)
      .on_key_down((event, cx) => this.onKey(event, cx))
      .on_size_change((size, cx) => {
        if (this.width !== size.width) {
          this.width = size.width;
          cx.notify();
        }
      })
      .child(this.headerView(t, contentPad, narrow))
      .child(
        v_flex()
          .id("cb-body")
          .w_full()
          .min_h(0)
          .flex_1()
          .overflow_y_scrollbar()
          .child(this.body(t, contentPad)),
      );
  }
}
