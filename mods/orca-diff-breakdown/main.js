// Diff Breakdown panel for herdr-orca.
// Ported from adamthewilliam/orca-diff-breakdown (MIT): a right-sidebar view that sorts a
// branch's changes by kind (runtime, tests, contracts, migrations, CI/CD, config,
// dependencies, docs). Herdr has no worker/plugin API, so the git reads and grouping run
// in the mod itself. PERF: all git work is done in ONE shell exec (a pipe inside sh gives
// us stdin for check-attr, which herdr's exec() lacks), instead of ~15 separate exec() IPCs.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, Scrollbar, v_virtual_list } from "gpui-base";
import { spaces, exec, readTextFile, watchFolder, theme, run } from "herdr";
import {
  createClassifier, detectEcosystems, groupFiles, parseOverrides,
  formatShare, parseNulList, parseNameStatusZ, parseNumstatZ, parseCheckAttr
} from "./diff.js";

const OVERRIDES_PATH = ".orca/diff-breakdown.json";

// One exec() -> one shell -> all git reads. Sections are RS(name)US(content); binary
// payloads inside sections use NUL. $1 is the repo root passed as the 4th exec arg.
const COLLECT = String.raw`
cd "$1" || exit 1
G='git --no-optional-locks -c core.fsmonitor=false -c diff.autoRefreshIndex=false'
emit() { printf '\036%s\037' "$1"; }
emit root; $G rev-parse --show-toplevel | tr -d '\n'
emit gitdirs; $G rev-parse --path-format=absolute --git-dir --git-common-dir 2>/dev/null
head=$($G rev-parse --verify --quiet HEAD 2>/dev/null)
emit head; printf '%s' "$head"
emit branch; $G rev-parse --abbrev-ref HEAD | tr -d '\n'
base=''
rh=$($G symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null)
for ref in $rh origin/main origin/master main master; do
  [ -n "$ref" ] || continue
  if base_oid=$($G rev-parse --verify --quiet "$ref^{commit}" 2>/dev/null); then base="$ref"; break; fi
done
emit base; printf '%s' "$base"
emit baseoid; printf '%s' "$base_oid"
from=''
[ -n "$base_oid" ] && [ -n "$head" ] && from=$($G merge-base "$base_oid" "$head" 2>/dev/null)
target="$from"
[ -z "$target" ] && target="$head"
emit target; printf '%s' "$target"
algo=$($G config --get diff.algorithm 2>/dev/null)
emit numstat
if [ -n "$target" ]; then
  if [ -n "$algo" ]; then $G diff-index -z -M --no-ext-diff "--diff-algorithm=$algo" --numstat --no-textconv "$target" --; else $G diff-index -z -M --no-ext-diff --numstat --no-textconv "$target" --; fi
fi
emit namestatus
if [ -n "$target" ]; then
  if [ -n "$algo" ]; then $G diff-index -z -M --no-ext-diff "--diff-algorithm=$algo" --name-status "$target" --; else $G diff-index -z -M --no-ext-diff --name-status "$target" --; fi
fi
emit markers
$G ls-files -z -- ':(glob)**/Cargo.toml' ':(glob)**/package.json' ':(glob)**/pyproject.toml' ':(glob)**/setup.py' ':(glob)**/requirements.txt' ':(glob)**/Pipfile' ':(glob)**/go.mod' ':(glob)**/pom.xml' ':(glob)**/build.gradle' ':(glob)**/build.gradle.kts' ':(glob)**/*.csproj' ':(glob)**/*.fsproj' ':(glob)**/*.sln' ':(glob)**/Package.swift' ':(glob)**/Podfile' ':(glob)**/Gemfile' ':(glob)**/composer.json' ':(glob)**/mix.exs'
emit untracked
$G ls-files --others --exclude-standard -z | while IFS= read -r -d '' f; do
  [ -f "$f" ] || continue
  if head -c 8000 "$f" | LC_ALL=C od -An -v -tx1 | grep -qw 00; then n=-1; else n=$(awk 'END{print NR+0}' "$f" 2>/dev/null); fi
  printf '%s\0%s\0' "$f" "$n"
done
emit attrs
if [ -n "$target" ]; then
  $G diff-index -z -M --no-ext-diff --name-only "$target" -- | $G check-attr -z linguist-generated linguist-vendored linguist-documentation --stdin 2>/dev/null
fi
emit end
`;

const RS = "\x1e", US = "\x1f";
function parseSections(out) {
  const o = {};
  for (const p of out.split(RS)) {
    if (!p) continue;
    const i = p.indexOf(US);
    if (i >= 0) o[p.slice(0, i)] = p.slice(i + 1);
  }
  return o;
}
function parseUntracked(out) {
  const parts = out.split("\0"), rows = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    if (!parts[i]) continue;
    const n = Number(parts[i + 1]);
    rows.push({ path: parts[i], status: "U", added: Number.isFinite(n) && n >= 0 ? n : null, deleted: null });
  }
  return rows;
}

// Orca scopes the panel to the project folder, not the focused terminal's cwd.
function location() {
  const space = (spaces() ?? []).find(s => s.active);
  return { cwd: space?.folder ?? null, on: space?.machine ?? null, space: space?.id, branch: space?.branch ?? null };
}
const key = (where = location()) => JSON.stringify(where);
const okay = (r) => r && r.code === 0;

function relPath(from, to) {
  const a = from.replace(/\/+$/, "").split("/"), b = to.split("/");
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return [...Array(a.length - i).fill(".."), ...b.slice(i)].join("/");
}

const CATEGORY_COLORS = {
  runtime: "#5b8def", tests: "#f0a35e", contracts: "#b39af7", migrations: "#f2d675",
  cicd: "#3fa7c9", config: "#ef7fae", dependencies: "#9aa5b1", docs: "#7fc8c0", generated: "#6b6f76"
};

export default class DiffBreakdown extends View {
  init(_props, cx) {
    this.snapshot = null;
    this.context = null;
    this.snapshots = new Map();
    this.pending = new Map();
    this.open = new Set();
    this.refresh(cx);
    cx.timer.every(30000, (cx) => this.refresh(cx));
  }

  stopWatching() {
    const watcher = this.watching;
    this.watching = null;
    for (const wait of watcher?.waits.values() ?? []) wait.cancel();
  }

  watch({ root, gitDir, commonDir }, context, cx) {
    if (this.watching?.root === root && this.watching.gitDir === gitDir && this.watching.commonDir === commonDir) return;
    this.stopWatching();
    const watcher = { root, gitDir, commonDir, waits: new Map(), queued: false };
    this.watching = watcher;
    for (const folder of new Set([root, gitDir, commonDir].filter(Boolean))) {
      cx.spawn(async (cx) => {
        try {
          while (this.watching === watcher) {
            const wait = watchFolder(folder);
            watcher.waits.set(folder, wait);
            const paths = await wait;
            if (this.watching !== watcher) return;
            const sharedChanged = folder === commonDir && paths.some(path => {
              const relative = path.slice(commonDir.length + 1);
              return path === commonDir || relative === "refs" || relative.startsWith("refs/") && !relative.endsWith(".lock")
                || ["packed-refs", "config", "shallow", "info", "info/attributes", "info/exclude"].includes(relative);
            });
            const localChanged = paths.some(path =>
              folder === root && !path.startsWith(`${root}/.git/`)
              || folder === gitDir && (path === gitDir || ["HEAD", "index", "config.worktree"].some(name => path === `${gitDir}/${name}`)));
            if (!sharedChanged && !localChanged) continue;

            for (const [id, snap] of this.snapshots) {
              if (!snap.on && (snap.root === root || sharedChanged && snap.commonDir === commonDir)) this.snapshots.delete(id);
            }
            const pending = this.pending.get(context);
            if (pending) pending.dirty = true;
            if (!watcher.queued) {
              watcher.queued = true;
              cx.timer.after(120, (cx) => {
                watcher.queued = false;
                if (this.watching === watcher && key() === context) this.refresh(cx);
              });
            }
          }
        } catch {
          // The timer still refreshes folders the host cannot watch.
        } finally {
          watcher.waits.delete(folder);
        }
      });
    }
  }

  refresh(cx) {
    const where = location(), context = key(where);
    const { cwd, on, branch } = where;
    if (context !== this.context) {
      this.stopWatching();
      this.context = context;
      this.snapshot = this.snapshots.get(context) ?? null;
      if (!on && this.snapshot?.root) this.watch(this.snapshot, context, cx);
      cx.notify();
    }
    if (!cwd || this.pending.has(context)) return;
    const request = { dirty: false };
    this.pending.set(context, request);
    const isCurrent = () => this.context === context && key() === context;
    cx.spawn(async (cx) => {
      try {
        // ONE exec for all git reads (shell pipes supply check-attr's stdin).
        const r = await exec("sh", ["-c", COLLECT, "collect", cwd], { cwd, on, timeout: 30000 });
        if (!isCurrent() || request.dirty) return;
        if (!okay(r)) { this.snapshot = { state: "error", message: (r.stderr || "git failed").trim() }; return; }
        const s = parseSections(r.stdout);
        const root = (s.root || "").trim();
        if (!root) { this.snapshot = { state: "not-git" }; return; }

        const [gitDir, commonDir] = (s.gitdirs || "").trimEnd().split("\n");
        if (!on) this.watch({ root, gitDir, commonDir }, context, cx);
        const overridesText = await readTextFile(`${root}/${OVERRIDES_PATH}`, { on }).catch(() => null);
        if (!isCurrent() || request.dirty) return;
        let overrides, overridesError;
        if (overridesText !== null) {
          try { overrides = parseOverrides(overridesText); }
          catch (e) { overridesError = `${OVERRIDES_PATH}: ${e.message}`; }
        }

        const stats = parseNumstatZ(s.numstat || "");
        const statuses = new Map(parseNameStatusZ(s.namestatus || "").map(x => [x.path, x]));
        const tracked = stats.map(stat => {
          const st = statuses.get(stat.path) ?? { path: stat.path, status: "M" };
          return { ...st, added: stat.added, deleted: stat.deleted };
        });
        const files = [...tracked, ...parseUntracked(s.untracked || "")].sort((a, b) => a.path.localeCompare(b.path));

        const markers = parseNulList(s.markers || "");
        const ecosystems = detectEcosystems(markers);
        const classifier = createClassifier({
          ecosystems, overrides, attributes: parseCheckAttr(s.attrs || "")
        });
        const groups = groupFiles(files, classifier);
        const counted = groups.filter(g => g.id !== "generated");
        this.snapshot = {
          state: "ok", root, on, gitDir, commonDir, head: s.head, baseOid: s.baseoid, branch: (s.branch || "").trim(), base: (s.base || "").trim() || null,
          ecosystems: ecosystems.map(e => e.name),
          overrides: overridesText === null ? null : OVERRIDES_PATH, overridesError, groups,
          added: counted.reduce((sum, g) => sum + g.added, 0),
          deleted: counted.reduce((sum, g) => sum + g.deleted, 0)
        };
        for (const [id, snap] of this.snapshots) {
          if (snap.on !== on) continue;
          const headChanged = snap.root === root && snap.head !== s.head;
          const baseChanged = commonDir && snap.commonDir === commonDir
            && (snap.base !== this.snapshot.base || snap.baseOid !== s.baseoid);
          if (headChanged || baseChanged) this.snapshots.delete(id);
        }
        // The host's branch is a hint from the shown terminal. Git owns the actual branch.
        if (this.snapshot.branch !== "HEAD" && (!branch || branch === this.snapshot.branch)) {
          this.snapshots.delete(context);
          this.snapshots.set(context, this.snapshot);
          if (this.snapshots.size > 8) this.snapshots.delete(this.snapshots.keys().next().value);
        } else {
          this.snapshots.delete(context);
        }
      } catch (e) {
        if (isCurrent() && !request.dirty) this.snapshot = { state: "error", message: String(e).trim() };
      } finally {
        this.pending.delete(context);
        if (isCurrent()) {
          if (request.dirty && !this.watching?.queued) this.refresh(cx);
          cx.notify();
        }
      }
    });
  }

  toggle(id, cx) {
    if (this.open.has(id)) this.open.delete(id);
    else this.open.add(id);
    cx.notify();
  }

  openFile(path, snap) {
    const where = location(), context = key(where);
    const current = context === this.context ? this.snapshot : this.snapshots.get(context);
    if (snap !== current || snap?.state !== "ok") return;
    const { cwd } = where;
    const file = cwd && cwd !== snap.root ? relPath(cwd, `${snap.root}/${path}`) : path;
    run("tab.new", { mod: "orca-files", props: { file } });
  }

  lineCounts(added, deleted, t, small = false) {
    if (added === null && deleted === null) return div().flex_none().text_size(small ? 11 : 12).text_color(t.dim).child("binary");
    return h_flex().flex_none().gap(6).text_size(small ? 11 : 12)
      .children([
        added ? div().text_color("#5fcf85").child(`+${added.toLocaleString()}`) : null,
        deleted ? div().text_color("#f07872").child(`−${deleted.toLocaleString()}`) : null
      ].filter(Boolean));
  }

  groupRow(group, snap, t) {
    const isOpen = this.open.has(group.id);
    const generated = group.id === "generated";
    const share = formatShare(group.added + group.deleted, snap.added + snap.deleted);
    const files = `${group.files.length} ${group.files.length === 1 ? "file" : "files"}`;
    return h_flex().w_full().h_full().items_center().gap(8).px(12)
      .border_b(1).border_color(t.border).cursor_pointer().hover(s => s.bg(t.hover))
      .child(div().w(12).flex_none().text_center().text_color(t.dim).child(isOpen ? "▾" : "▸"))
      .child(div().w(10).h(10).rounded(3).bg(CATEGORY_COLORS[group.id] ?? t.dim).flex_none())
      .child(div().flex_none().text_size(13).font_weight(600).text_color(generated ? t.dim : t.foreground).child(group.name))
      .child(div().flex_1().min_w(0))
      .child(div().flex_none().text_size(12).text_color(t.dim).child(files))
      .child(div().w(36).flex_none().text_size(12).text_color(t.dim).text_right().child(generated ? "—" : share))
      .child(this.lineCounts(group.added, group.deleted, t));
  }

  groupList(snap, t) {
    const count = snap.groups.reduce((total, group) => total + 1 + (this.open.has(group.id) ? group.files.length : 0), 0);
    const rowAt = index => {
      for (const group of snap.groups) {
        if (index-- === 0) return group;
        if (this.open.has(group.id)) {
          if (index < group.files.length) return { group, file: group.files[index] };
          index -= group.files.length;
        }
      }
    };
    return v_flex().id("diff-groups").flex_1().min_h(0).relative()
      .child(v_virtual_list("breakdown-rows", count, 32,
        i => {
          const row = rowAt(i);
          return row.file ? `file:${row.group.id}:${row.file.path}:${row.file.status}` : `group:${row.id}`;
        },
        range => Array.from({ length: range.end - range.start }, (_, offset) => rowAt(range.start + offset)).map(row =>
          row.file ? this.fileRow(row.file, t) : this.groupRow(row, snap, t)))
        .on_item_click((key, cx) => {
          if (key.startsWith("group:")) {
            this.toggle(key.slice(6), cx);
            return;
          }
          const statusAt = key.lastIndexOf(":");
          if (key.slice(statusAt + 1) !== "D") this.openFile(key.slice(key.indexOf(":", 5) + 1, statusAt), snap);
        })
        .size_full())
      .child(Scrollbar.vertical("breakdown-rows").viewport_from_layout().absolute().inset_0());
  }

  fileRow(file, t) {
    const slash = file.path.lastIndexOf("/");
    const name = file.path.slice(slash + 1);
    const dir = slash === -1 ? "" : file.path.slice(0, slash);
    const title = file.oldPath ? `${file.oldPath} → ${file.path}` : file.path;
    const tone = file.status === "A" || file.status === "U" ? "#5fcf85"
      : file.status === "D" ? "#f07872" : "#d9b25a";
    const content = [
      div().w(14).flex_none().text_color(t.dim).child(svg("mods/orca-diff-breakdown/file.svg").size(13)),
      div().flex_none().max_w(180).truncate().text_size(12.5).text_color(file.status === "D" ? t.dim : t.foreground)
        .when(file.status === "D", e => e.line_through()).child(name),
      div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(dir),
      this.lineCounts(file.added, file.deleted, t, true),
      div().w(14).flex_none().text_center().text_size(12).font_weight(600).text_color(tone).child(file.status)
    ];
    return h_flex().w_full().h_full().items_center().gap(8).px(12).pl(34)
      .tooltip(title)
      .when(file.status !== "D", row => row.cursor_pointer().hover(s => s.bg(t.hover)))
      .children(content);
  }

  bar(snap, t) {
    // Zero-change groups would become a 4px sliver that steals the rounded right end.
    const counted = snap.groups.filter(g => g.id !== "generated" && g.added + g.deleted > 0);
    const total = snap.added + snap.deleted;
    // overflow_hidden only clips to a rectangle, so each slice clips a full-bar-sized pill:
    // ends are true arcs, inner cuts are flat, widths stay exactly proportional.
    let x = 0;
    return div().id("breakdown-bar").relative().w_full().h(12).rounded(6).bg(t.hover)
      .children(counted.map(g => {
        const f = total === 0 ? 1 / counted.length : (g.added + g.deleted) / total, left = x;
        x += f;
        const pct = n => `${(n * 100).toFixed(4)}%`;
        return div().absolute().top(0).bottom(0).left(pct(left)).w(pct(f)).overflow_hidden()
          .tooltip(`${g.name}: ${formatShare(g.added + g.deleted, total)} · ${g.files.length} files`)
          .child(div().absolute().top(0).bottom(0).left(pct(-left / f)).w(pct(1 / f)).rounded(6).bg(CATEGORY_COLORS[g.id] ?? t.dim));
      }));
  }

  render(cx) {
    const t = theme(), where = location(), context = key(where);
    if (context !== this.context) {
      cx.timer.after(0, (cx) => { if (key() !== this.context) this.refresh(cx); });
    }
    const snap = context === this.context ? this.snapshot : this.snapshots.get(context);
    if (!where.cwd || !snap) {
      return v_flex().id("diff-breakdown").size_full().items_center().justify_center().text_color(t.muted)
        .child(!where.cwd ? "Select a workspace" : where.branch ? `Loading changes on ${where.branch}…` : "Loading changes…");
    }
    if (snap.state === "not-git") {
      return v_flex().id("diff-breakdown").size_full().items_center().justify_center().px(16).text_color(t.muted)
        .child(div().text_size(13).text_color(t.foreground).child("Not a Git repository"))
        .child(div().mt(4).text_size(12).text_center().child("Open a Git workspace to see its changes by category."));
    }
    if (snap.state === "error") {
      return v_flex().id("diff-breakdown").size_full().items_center().justify_center().px(16).text_color(t.muted)
        .child(div().text_size(13).text_color(t.foreground).child("Couldn't read changes"))
        .child(div().mt(4).text_size(12).text_center().child(snap.message));
    }
    if (snap.state === "ok" && snap.groups.length === 0) {
      return v_flex().id("diff-breakdown").size_full().items_center().justify_center().px(16).text_color(t.muted)
        .child(div().text_size(13).text_color(t.foreground).child(`No changes on ${snap.branch}`))
        .child(div().mt(4).text_size(12).text_center().child("Edits will appear here, broken down by kind, as you work."));
    }

    const counted = snap.groups.some(g => g.id !== "generated");
    return v_flex().id("diff-breakdown").size_full().min_h(0).overflow_hidden().text_color(t.foreground)
      .child(
        h_flex().id("diff-head").w_full().min_h(44).items_center().gap(8).px(12).border_b(1).border_color(t.border)
          .child(div().text_size(12).text_color(t.foreground).child(snap.branch))
          .child(div().flex_1().min_w(0))
          .child(this.lineCounts(snap.added, snap.deleted, t))
      )
      .child(div().mt(8).px(12).child(div().text_size(11).text_color(t.dim).child(`vs ${snap.base ?? "HEAD"}`)))
      .when(counted, el => el.child(div().px(12).py(10).child(this.bar(snap, t))))
      .child(this.groupList(snap, t))
      .when(Boolean(snap.overridesError), el => el.child(div().px(12).py(8).border_t(1).border_color(t.border).text_size(11).text_color("#f07872").child(snap.overridesError)))
      .when(Boolean(snap.overrides && !snap.overridesError), el => el.child(div().px(12).py(8).border_t(1).border_color(t.border).text_size(11).text_color(t.dim).child(`Categories from ${snap.overrides}`)));
  }
}
