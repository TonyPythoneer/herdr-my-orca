import { world, makeCx, settle, deliver, goldenSuite, fresh, handler, Files } from "./flow-harness.mjs";

const node = (x) => x?.__node ?? x;
const short = (value) => JSON.parse(JSON.stringify(value, (_k, v) => typeof v === "string" && v.length > 90 ? `${v.slice(0, 40)}…[${v.length}]` : v));
const trace = () => ({ overlays: world.overlays, closed: world.closed, runs: world.runs, copied: world.copied, shared: world.sharedLog, writes: world.writes,
  execs: world.execLog.map(([c, a, o]) => [c, a, o]).filter(([c]) => c !== "sh" || true) });
const calm = () => { world.overlays.length = 0; world.closed.length = 0; world.runs.length = 0; world.copied.length = 0; world.sharedLog.length = 0; world.execLog.length = 0; world.writes.length = 0; };
const TREE = { "/repo": [["d", "src"], ["f", "a.js"], ["f", ".env"], ["l", "ln"], ["f", "Dockerfile"], ["f", "x.tar.gz"], ["f", "noext"], ["f", "pkg.json"]], "/repo/src": [["f", "i.js"]] };
const STATUS = " M a.js\0?? src/i.js\0!! .env\0 D gone\0";
const repoHost = (extra = {}) => (cmd, args) => {
  if (cmd === "sh" && args[2] === "files") return { code: TREE[args[3]] ? 0 : 1, stdout: (TREE[args[3]] ?? []).map(([k, n]) => `${k}\0${n}\0`).join(""), stderr: "" };
  if (cmd === "git" && args.includes("rev-parse")) return { code: 0, stdout: "/repo\n", stderr: "" };
  if (cmd === "git" && args.includes("status")) return { code: 0, stdout: STATUS, stderr: "" };
  return extra[cmd]?.(args) ?? { code: 0, stdout: "", stderr: "" };
};
const repo = (extra, setup) => fresh(() => { world.exec = repoHost(extra); setup?.(); });
const loc = { cwd: "/repo", on: null, space: "s1" };
async function overlayCopy(props) {
  world.props = props;
  const cx = makeCx(), view = new Files();
  view.init({}, cx); await settle(); calm();
  return { view, cx };
}
const menuProps = (path, dir, overlay = "menu-1", location = loc) => ({ tab: "file", overlay, target: { path, dir, location } });
const renderNode = (view, cx) => node(view.render(cx));

goldenSuite("files-ui", {
  "the files pane renders the tree with marks, icons, selection and an open row": async () => {
    const { view, cx } = await repo();
    view.toggle("src", cx); await settle(); view.refresh(cx); await settle();
    view.selected = "a.js";
    const out = { tree: renderNode(view, cx) };
    const renderRows = globalThis.__fns.findLast((h) => h.key === "arg" && h.node === "v_virtual_list" && h.fn.length === 1 && String(h.fn).includes("slice")).fn;
    out.rows = renderRows({ start: 0, end: 50 }).map(node);
    view.file = "src/i.js"; out.rowsPreviewed = renderRows({ start: 0, end: 50 }).map(node);
    return out;
  },
  "the tree row covers folder states, links, every icon family, git tones and ignored marks": async () => {
    const { view } = await repo();
    const t = { ...globalThis.__herdrTheme() };
    const names = ["a.js", "x.tar.gz", "x.TAR.BZ2", "Dockerfile", "Dockerfile.dev", "Makefile", "makefile.x", ".env", ".env.local", "package.json", "README.md", "readme", "LICENSE", "a.png", "a.mp3", "a.mp4", "a.zip",
      "a.sql", "a.csv", "a.ipynb", "a.json", "a.gql", "a.diff", "a.sh", "a.gradle", "a.glb", "a.lock", "a.css", "a.toml", "pnpm-lock.yaml", ".gitignore", "noext", ".hidden", "x.unknownext", "CMakeLists.txt", "security.md", "a.vue", "settings.gradle"];
    view.marks = { "a.js": "M", "n/new": "A", "n/gone": "D", "n/u": "U", "n/r": "R", "n/c": "C", "n/ig": "!", "n/odd": "?" };
    view.folderMarks = { fm: "M" }; view.pending = new Set(["loading"]); view.folderErrors = { failed: "boom: denied" };
    view.file = "a.js"; view.selected = "sel";
    const row = (r) => node(view.row({ name: r.path.split("/").pop(), depth: 0, open: false, ...r }, t));
    return {
      files: names.map((name) => [name, row({ path: name, dir: false })]),
      folders: [["loading", {}], ["failed", {}], ["open", { open: true }], ["shut", {}], ["fm", {}]].map(([path, extra]) => [path, row({ path, dir: true, ...extra })]),
      link: row({ path: "ln", dir: false, link: true }),
      marks: ["n/new", "n/gone", "n/u", "n/r", "n/c", "n/ig", "n/odd"].map((path) => row({ path, dir: false, depth: 2 })),
      selected: row({ path: "sel", dir: false }), previewed: row({ path: "a.js", dir: false }),
    };
  },
  "the files pane renders its empty, loading, error, filter and limit states": async () => {
    const out = {};
    const a = await fresh(() => { world.spaces = []; });
    out.noWorkspace = renderNode(a.view, a.cx);
    const b = await fresh(() => { world.exec = () => ({ code: 1, stdout: "", stderr: "denied" }); });
    out.error = renderNode(b.view, b.cx);
    const c = await repo({}, () => { TREE["/repo"] = []; });
    out.empty = renderNode(c.view, c.cx);
    c.view.loading = true; out.loading = renderNode(c.view, c.cx);
    TREE["/repo"] = [["f", "a.js"]];
    const d = await repo();
    d.view.limited = true; d.view.operationError = "Delete failed: nope";
    out.limited = renderNode(d.view, d.cx);
    d.view.name.set_value("zz"); d.view.nfMap = null; d.view.nfLoading = true; out.filterLoading = renderNode(d.view, d.cx);
    d.view.nfMap = new Map(); d.view.nfLoading = false; out.filterEmpty = renderNode(d.view, d.cx);
    d.view.nfMap = new Map([["", [{ name: "a.js", dir: false }]]]); out.filtered = renderNode(d.view, d.cx);
    TREE["/repo"] = [["d", "src"], ["f", "a.js"], ["f", ".env"], ["l", "ln"], ["f", "Dockerfile"], ["f", "x.tar.gz"], ["f", "noext"], ["f", "pkg.json"]];
    return out;
  },
  "the search view renders its summary, grouped hits, collapse state and empty copy": async () => {
    const { view, cx } = await repo();
    view.view = "search"; view.q.set_value("needle"); view.include.set_value("*.js"); view.exclude.set_value(" "); view.filtersOpen = true;
    const out = { noHits: renderNode(view, cx) };
    view.hits = { totalMatches: 1, fileCount: 1, truncated: false, files: [{ path: "src/a.js", matches: [{ line: 3, column: 4, text: "needle here" }] }, { path: "root.md", matches: [{ line: 1, column: 1, text: "x" }, { line: 2, column: 1, text: "y" }] }] };
    out.hits = renderNode(view, cx);
    view.collapsedSearch.add("src/a.js"); out.collapsed = renderNode(view, cx);
    view.hits = { totalMatches: 201, fileCount: 2, truncated: true, files: [] }; out.truncated = renderNode(view, cx);
    view.hits = { totalMatches: 0, fileCount: 0, truncated: false, files: [] }; out.none = renderNode(view, cx);
    view.searching = true; view.hits = { totalMatches: 0, fileCount: 0, truncated: false, files: [] }; out.searching = renderNode(view, cx);
    view.filtersOpen = false; view.qFocused = true; view.caseSensitive = true; view.wholeWord = true; view.useRegex = true; out.toggles = renderNode(view, cx);
    return out;
  },
  "an open file renders its header, status text and editor or fallback message": async () => {
    const { view, cx } = await repo(undefined, () => { world.files.set("/repo/a.js", "code"); });
    view.show("a.js", cx); await settle();
    const out = { editable: renderNode(view, cx), editableDoc: { status: view.doc?.status, readonly: view.code.opts.readonly } };
    view.doc.status = "editing"; out.editing = renderNode(view, cx);
    view.doc.status = "saved"; out.saved = renderNode(view, cx);
    view.doc.status = "failed"; view.doc.error = "E".repeat(100); out.failed = renderNode(view, cx);
    view.doc.status = "other"; out.other = renderNode(view, cx);
    view.doc = null; view.fileError = null; out.readonly = renderNode(view, cx);
    view.fileError = "Read-only: because"; out.readonlyWhy = renderNode(view, cx);
    view.code = null; out.loadingFile = renderNode(view, cx);
    view.fileError = "Cannot preview"; out.failedFile = renderNode(view, cx);
    return out;
  },
  "search results collapse a file on click and open a match in the preview": async () => {
    const { view, cx } = await repo(undefined, () => { world.files.set("/repo/src/a.js", "needle"); });
    view.view = "search";
    view.hits = { totalMatches: 2, fileCount: 1, truncated: false, files: [{ path: "src/a.js", matches: [{ line: 1, column: 1, text: "needle" }, { line: 2, column: 1, text: "needle" }] }] };
    renderNode(view, cx);
    handler("files-hit-file-src/a.js", "on_click")({}, cx); const collapsed = [...view.collapsedSearch];
    renderNode(view, cx); handler("files-hit-file-src/a.js", "on_click")({}, cx);
    const reopened = [...view.collapsedSearch];
    renderNode(view, cx); handler("files-hit-src/a.js-1", "on_click")({}, cx); await settle();
    return { collapsed, reopened, shown: { file: view.file, text: view.code?.value() } };
  },
  "the toolbar, query strip, search toggles and filters row react to their handlers": async () => {
    const { view, cx } = await repo();
    const out = { start: renderNode(view, cx) };
    const click = (id, ...args) => { handler(id, "on_click")(...(args.length ? args : [{}, cx])); };
    click("files-contents"); out.view = view.view;
    click("files-names"); out.view2 = view.view;
    view.folders.add("src"); view.entries.set("src", []);
    renderNode(view, cx); click("files-collapse"); out.collapsed = [...view.folders];
    const before = world.execLog.length; renderNode(view, cx); click("files-refresh"); await settle(); out.refreshed = world.execLog.length > before;
    world.treeFocused = true; renderNode(view, cx); handler("files-more", "on_click")(); out.more = world.overlays.splice(0);
    view.git = true; renderNode(view, cx); handler("files-more", "on_click")(); out.moreGit = world.overlays.splice(0);
    view.loading = true; out.loadingToolbar = renderNode(view, cx);
    view.loading = false; view.view = "search"; out.searchToolbar = renderNode(view, cx);
    for (const id of ["files-case", "files-word", "files-regex"]) click(id);
    out.toggles = [view.caseSensitive, view.wholeWord, view.useRegex];
    click("files-filters-toggle"); out.filtersOpen = view.filtersOpen;
    view.q.set_value("abc"); view.hits = { files: [], totalMatches: 0 }; view.searching = true; renderNode(view, cx);
    click("files-clear-contents"); out.cleared = { q: view.q.value(), hits: view.hits, searching: view.searching };
    view.view = "files"; view.name.set_value("abc"); view.nfMap = new Map(); view.nfLoading = true; renderNode(view, cx);
    click("files-clear-names"); out.clearedNames = { name: view.name.value(), nfMap: view.nfMap, loading: view.nfLoading };
    return out;
  },
  "the tree list opens rows by key, shows the row menu and scrolls to keyboard moves": async () => {
    const { view, cx } = await repo(undefined, () => { world.files.set("/repo/a.js", "x"); });
    view.toggle("src", cx); await settle();
    renderNode(view, cx);
    const click = handler(undefined, "on_item_click"), secondary = handler(undefined, "on_item_secondary_click");
    const out = {};
    click("src", cx); out.dir = { selected: view.selected, folders: [...view.folders], focus: world.focused };
    click("a.js", cx); await settle(); out.file = { file: view.file, selected: view.selected };
    click("missing", cx); view.show(null, cx);
    view.name.set_value("q"); view.nfMap = new Map([["", [{ name: "n", dir: true }]]]); renderNode(view, cx);
    handler(undefined, "on_item_click")("n", cx); out.named = [...view.nfCollapsed];
    handler(undefined, "on_item_secondary_click")("n", {}, cx); out.menuOverlay = world.overlays.splice(0); out.stopped = world.stopped;
    secondary("zzz", {}, cx);
    view.view = "files"; view.name.set_value(""); renderNode(view, cx);
    view.treeFocus = { is_focused: () => true, focus() {} }; view.file = null; view.selected = "src";
    view.treeKey({ key: "arrowdown", modifiers: {} }, cx);
    out.moved = { selected: view.selected, scrolled: world.scrolled };
    return out;
  },
});

async function actOn(name, { path = "src/i.js", dir = false, location = loc, overlay = "menu-1", setup } = {}) {
  const main = await repo(undefined, setup);
  world.platform ||= "macos";
  calm();
  const { view, cx } = await overlayCopy(menuProps(path, dir, overlay, location));
  const result = view.act(name, cx);
  await settle();
  return { main: main.view, view, cx, returned: result === undefined ? null : String(result), trace: short(trace()) };
}
const state = (m) => ({ prompt: m.view.prompt && { ...m.view.prompt }, input: m.view.input.log(), mainError: m.main.operationError, trace: m.trace, returned: m.returned });

goldenSuite("files-ui-actions", {
  "act without a target does nothing and a target from another workspace is refused": async () => {
    const out = {};
    const main = await repo(); calm();
    const bare = await overlayCopy({ tab: "file" }); bare.view.act("new-file", bare.cx); out.noTarget = short(trace());
    const stale = await actOn("new-file", { location: { cwd: "/other", on: null, space: "s9" } });
    out.stale = state(stale);
    const noLocation = await overlayCopy({ tab: "file", overlay: "m", target: { path: "a", dir: false } });
    noLocation.view.act("new-file", noLocation.cx); out.noLocation = short(trace());
    void main;
    return out;
  },
  "new file and new folder ask for a name in the popup, aimed at the folder": async () => {
    const out = {};
    for (const [label, name, path, dir] of [["fileInFile", "new-file", "src/i.js", false], ["fileInDir", "new-file", "src", true], ["folderInRoot", "new-folder", "a.js", false], ["folderInDir", "new-folder", "src", true]]) out[label] = state(await actOn(name, { path, dir }));
    return out;
  },
  "copy actions use the pasteboard on macOS and the path elsewhere, then close the popup": async () => {
    const out = {};
    const linux = () => { world.platform = "linux"; };
    out.macCopy = state(await actOn("copy-file"));
    out.linuxCopy = state(await actOn("copy-file", { setup: linux }));
    out.path = state(await actOn("copy-path", { setup: linux }));
    out.rel = state(await actOn("copy-rel"));
    out.macFails = state(await actOn("copy-file", { setup: () => { world.exec = (cmd, args) => { if (cmd === "osascript") throw new Error("no osascript"); return repoHost()(cmd, args); }; } }));
    return out;
  },
  "duplicate runs the copy and reports failures on the main view": async () => {
    const out = {};
    out.ok = state(await actOn("duplicate"));
    const failed = await actOn("duplicate", { setup: () => { world.exec = repoHost({ sh: (args) => args[2] === "file-action" ? { code: 1, stdout: "", stderr: "boom" } : repoHost()("sh", args) }); } });
    out.failed = state(failed);
    return out;
  },
  "terminal, view file, reveal, rename and delete hand off as their menu items say": async () => {
    const out = {};
    out.terminalDir = state(await actOn("terminal", { path: "src", dir: true }));
    out.terminalFile = state(await actOn("terminal", { path: "a.js" }));
    const view = await actOn("view-file", { path: "src/i.js", setup: () => { world.files.set("/repo/src/i.js", "hi"); } });
    out.viewFile = { ...state(view), shownFile: view.main.file };
    out.reveal = state(await actOn("reveal", { path: "src", dir: true }));
    out.revealFile = state(await actOn("reveal"));
    out.rename = state(await actOn("rename", { path: "src/i.js" }));
    out.renameTop = state(await actOn("rename", { path: "a.js" }));
    out.delete = state(await actOn("delete"));
    out.unknown = state(await actOn("nothing"));
    out.noOverlay = state(await actOn("copy-path", { overlay: undefined }));
    return out;
  },
  "apply performs the pending New or Rename, keeps the prompt on an error and ignores a busy one": async () => {
    const out = {};
    const m = await actOn("new-file", { path: "src", dir: true });
    const { view, cx } = m;
    out.none = (() => { const v = new Files(); v.prompt = null; v.apply("x", cx); return world.notifies >= 0; })();
    calm(); view.apply("new.txt", cx); out.busy = view.prompt.busy; view.apply("again", cx); await settle();
    out.done = { prompt: view.prompt, closed: world.closed, runs: world.runs, execs: short(world.execLog.map(([c, a, o]) => [c, a.slice(-6), o])), busy: m.main.loading };
    const bad = await actOn("new-file", { setup: () => { world.exec = repoHost({ sh: (args) => args[2] === "file-action" ? { code: 1, stdout: "", stderr: "exists" } : repoHost()("sh", args) }); } });
    calm(); bad.view.apply("dup", bad.cx); await settle();
    out.error = { prompt: bad.view.prompt, closed: world.closed };
    calm(); bad.view.apply("bad/name", bad.cx); await settle(); out.invalid = bad.view.prompt.error;
    const noOverlay = await overlayCopy({}); noOverlay.view.prompt = { mode: "touch", title: "t", full: "/repo", overlay: null, value: "", ...loc };
    noOverlay.view.apply("fresh", noOverlay.cx); await settle(); out.noOverlay = { prompt: noOverlay.view.prompt, closed: world.closed };
    return out;
  },
  "command handles remove, search, refresh, filters and view requests": async () => {
    const out = {};
    const { view, cx } = await repo(undefined, () => { world.files.set("/repo/v.txt", "viewed"); });
    out.unknown = await view.command("nothing", cx);
    world.shared.set("orca-files.target.tok", { ...loc, path: "/repo/a.js" });
    calm(); await view.command("remove-tok", cx); await settle();
    out.removed = { shared: world.sharedLog, execs: short(world.execLog.map(([c, a, o]) => [c, a.slice(-3), o])), error: view.operationError };
    await view.command("remove-gone", cx);
    world.shared.set("orca-files.target.bad", { ...loc, cwd: "/other", path: "/other/a" });
    await view.command("remove-bad", cx); out.removeError = view.operationError;
    await view.command("search", cx); out.search = { view: view.view, log: view.q.log() };
    view.q.set_value("x"); await view.command("search", cx); out.searchRerun = world.timers.filter((t) => t.ms === 200).length;
    view.reloadDraft = { path: "v.txt", context: view.context }; view.viewDraft = view.reloadDraft;
    await view.command("refresh", cx); await settle(); out.refreshDraft = { file: view.file, reload: view.reloadDraft };
    await view.command("refresh", cx);
    view.name.set_value("q"); const timers = world.timers.length; view.command("filters", cx); out.filters = world.timers.length - timers;
    world.shared.set("orca-files.viewFile", "v.txt"); await view.command("view", cx); await settle(); out.view = { file: view.file, shared: world.shared.get("orca-files.viewFile") };
    await view.command("view", cx);
    return out;
  },
  "startRename and requestDelete capture the workspace and refuse a stale one": async () => {
    const out = {};
    const { view, cx } = await repo();
    calm();
    view.startRename({ path: "src/i.js", name: "i.js" }, cx); out.rename = { prompt: view.prompt && { ...view.prompt }, input: view.input.log() };
    view.prompt = null;
    view.requestDelete("a.js", false, cx); out.delete = short(world.overlays.splice(0));
    world.spaces = [{ id: "s2", active: true, folder: "/two", machine: "m" }];
    view.startRename({ path: "a", name: "a" }, cx); out.staleRename = { prompt: view.prompt, error: view.operationError };
    view.operationError = null; view.requestDelete("a", false, cx); out.staleDelete = { overlays: world.overlays, error: view.operationError };
    view.root = null; view.startRename({ path: "a", name: "a" }, cx); out.noRoot = view.operationError;
    return out;
  },
  "treeKey routes keys to selection, folders, rename, delete and copy": async () => {
    const out = {};
    const { view, cx } = await repo();
    view.treeFocus = { is_focused: () => true, focus() {} };
    view.toggle("src", cx); await settle();
    renderNode(view, cx);
    calm();
    const press = (key, modifiers) => { world.stopped = 0; view.treeKey({ key, modifiers }, cx); return { selected: view.selected, folders: [...view.folders], stopped: world.stopped, scrolled: world.scrolled, prompt: view.prompt?.mode, file: view.file, overlays: world.overlays.length, copied: [...world.copied], name: view.nfCollapsed.size }; };
    const seq = [["arrowdown"], ["arrowdown"], ["arrowup"], ["end"], ["home"], ["pagedown"], ["pageup"], ["arrowright"], ["arrowright"], ["arrowleft"], ["arrowleft"], ["arrowleft"], ["x"], ["space"], ["arrowdown"], ["arrowdown"], ["arrowdown"], ["space"],
      ["c", { platform: true, alt: true }], ["c", { platform: true, alt: true, shift: true }], ["backspace", { platform: true }], ["backspace", { platform: true, shift: true }], ["a", { control: true }], ["enter"], ["delete"]];
    out.seq = [];
    for (const [key, modifiers] of seq) { view.prompt = null; view.file = null; out.seq.push([key, press(key, modifiers)]); }
    view.selected = null; out.fresh = [["arrowup"], ["x"]].map(([key]) => { view.selected = null; return press(key); });
    view.selected = "gone"; out.unknownRow = press("arrowdown"); out.unknownEnter = press("enter"); out.unknownCopy = press("c", { platform: true, alt: true }); out.unknownDel = press("backspace", { platform: true }); out.unknownDelete = press("delete");
    view.name.set_value("q"); view.nfMap = new Map([["", [{ name: "n", dir: true }, { name: "m", dir: false }]], ["n", [{ name: "o", dir: false }]]]); renderNode(view, cx);
    view.selected = "n"; out.filteredLeft = press("arrowleft"); out.filteredRight = press("arrowright"); out.filteredSpace = press("space");
    view.view = "search"; out.searchView = press("arrowdown");
    view.view = "files"; view.file = "x"; out.fileOpen = press("arrowdown");
    view.file = null; view.prompt = {}; out.prompting = press("arrowdown");
    view.prompt = null; world.treeFocused = false; view.treeFocus = { is_focused: () => false }; out.unfocused = press("arrowdown");
    return out;
  },
  "show opens text editable, read-only, as a draft or as an error, and flush keeps unsaved text": async () => {
    const out = {};
    const open = async (path, setup, mutate) => {
      const { view, cx } = await repo(undefined, setup);
      mutate?.(view); view.show(path, cx); await settle();
      return { file: view.file, text: view.code?.value().length > 1000 ? `[${view.code.value().length} chars] …${view.code.value().slice(-30)}` : view.code?.value(), opts: view.code?.opts, readonly: view.code?.opts.readonly, fileError: view.fileError, doc: view.doc && { full: view.doc.full, disk: view.doc.disk, status: view.doc.status }, view: view };
    };
    const strip = ({ view, ...rest }) => rest;
    out.plain = strip(await open("a.js", () => world.files.set("/repo/a.js", "plain")));
    out.noExt = strip(await open("noext", () => world.files.set("/repo/noext", "plain")));
    out.mjs = strip(await open("m.mjs", () => world.files.set("/repo/m.mjs", "x")));
    out.toml = strip(await open("c.toml", () => world.files.set("/repo/c.toml", "x")));
    out.other = strip(await open("c.zz", () => world.files.set("/repo/c.zz", "x")));
    out.absolute = strip(await open("/outside/f.txt", () => { world.files.set("/outside/f.txt", "x"); world.exec = () => ({ code: 1, stdout: "", stderr: "" }); }));
    out.binary = strip(await open("b.bin", () => world.files.set("/repo/b.bin", "a\0b")));
    out.missing = strip(await open("gone.txt"));
    out.big = strip(await open("big.txt", () => world.files.set("/repo/big.txt", "x".repeat(400001))));
    out.unsafe = strip(await open("u.txt", () => { world.files.set("/repo/u.txt", "x"); world.exec = (c, a) => c === "sh" && a[2] === "editor-path" ? { code: 1, stdout: "", stderr: "" } : repoHost()(c, a); }));
    out.normalised = strip(await open("n.txt", () => { world.files.set("/repo/n.txt", "a\r\nb"); world.normalize = (v) => v.replace(/\r/g, ""); }));
    world.normalize = null;
    out.remote = strip(await open("r.txt", () => { world.spaces = [{ id: "s1", active: true, folder: "/repo", machine: "m1" }]; world.files.set("/repo/r.txt", "x"); }));
    out.noWorkspace = strip(await open("rel.txt", () => { world.spaces = []; }));
    out.nothing = strip(await open(null));
    const a = await open("a.js", () => world.files.set("/repo/a.js", "disk"));
    a.view.code.type("typed", makeCx()); a.view.show("b.txt", makeCx()); await settle();
    out.leaving = { writes: world.writes, drafts: [...a.view.drafts.keys()], files: [...world.files] };
    const b = await open("a.js", () => world.files.set("/repo/a.js", "disk"));
    world.failWrite = new Error("external change");
    b.view.code.type("typed2", makeCx()); b.view.show("c.txt", makeCx()); await settle();
    world.failWrite = null;
    out.failedLeave = { drafts: [...b.view.drafts].map(([k, d]) => [k, d.text, d.disk, d.error]), error: b.view.operationError, runs: world.runs.splice(0) };
    b.view.show("a.js", makeCx()); await settle();
    out.reopenDraft = { text: b.view.code.value(), readonly: b.view.code.opts.readonly, fileError: b.view.fileError, viewDraft: Boolean(b.view.viewDraft) };
    return out;
  },
  "a draft that changes or disappears while its file is read is followed": async () => {
    const out = {};
    const draft = (text) => ({ text, disk: "disk", error: "external change" });
    const { view, cx } = await repo(undefined, () => { world.files.set("/repo/a.js", "disk"); });
    view.drafts.set("/repo/a.js", draft("first"));
    world.onRead = () => { view.drafts.set("/repo/a.js", draft("second")); world.onRead = null; };
    view.show("a.js", cx); await settle();
    out.replaced = { text: view.code.value(), error: view.fileError };
    view.show(null, cx); view.drafts.set("/repo/a.js", draft("third"));
    world.onRead = () => { view.drafts.delete("/repo/a.js"); world.onRead = null; };
    view.show("a.js", cx); await settle();
    out.removed = { text: view.code.value(), readonly: view.code.opts.readonly, error: view.fileError };
    view.show(null, cx); view.drafts.set("/repo/a.js", draft("kept"));
    world.files.delete("/repo/a.js"); view.show("a.js", cx); await settle();
    out.unreadable = { text: view.code.value(), error: view.fileError };
    return out;
  },
  "commands queued for the pane run in order, and a command that returns nothing ends the loop": async () => {
    const { view } = await repo();
    await deliver("remove-x"); await deliver(""); const alive = world.waiters.length;
    await deliver("search");
    return { view: view.view, alive, afterSearch: world.waiters.length, errors: world.spawnErrors, notifies: world.notifies > 0 };
  },
  "editing saves 800 ms after the last keystroke and reports success or failure": async () => {
    const out = {};
    const { view, cx } = await repo(undefined, () => { world.files.set("/repo/a.js", "disk"); });
    view.show("a.js", cx); await settle();
    const before = world.timers.length;
    view.code.type("one", cx); view.code.type("two", cx);
    out.after = world.timers.slice(before).map((t) => t.ms); out.status = view.doc.status;
    await world.timers[before].fn(cx); await settle(); out.stale = { status: view.doc.status, writes: world.writes.length };
    await world.timers[before + 1].fn(cx); await settle(); out.saved = { status: view.doc.status, writes: world.writes.map((w) => w.slice(1)), disk: view.doc.disk };
    world.failWrite = new Error("disk full");
    view.code.type("three", cx); await world.timers.at(-1).fn(cx); await settle();
    out.failed = { status: view.doc.status, error: view.doc.error, failure: String(view.doc.failure) };
    world.failWrite = null; view.code.type("four", cx); out.recovers = view.doc.failure;
    const other = { ver: 0 }; view.edited(other, cx); out.foreign = other.ver;
    await view.close(); out.closeWrites = world.writes.length;
    const idle = new Files(); idle.doc = null; out.flushNothing = idle.flush();
    return out;
  },
  "the More popup toggles the filters, and Open in lists apps from the system or the customised file": async () => {
    const out = {};
    const more = await overlayCopy({ tab: "more", overlay: "more-1", root: "/repo", git: true });
    out.more = renderNode(more.view, more.cx);
    handler("fx-0", "on_click")(); handler("fx-1", "on_click")(); handler("fx-2", "on_click")(); handler("fx-3", "on_click")();
    out.moreActions = short(trace()); calm();
    world.shared.set("orca-files.filters", { "/repo": { dotfiles: false, ignored: false } });
    world.platform = "windows"; out.moreWin = renderNode(more.view, more.cx);
    world.platform = "linux"; out.moreLinux = renderNode(more.view, more.cx);
    world.props = { tab: "more", overlay: "more-1", root: null, git: false }; out.moreNoGit = renderNode(more.view, more.cx);
    handler("fx-2", "on_click")(); handler("fx-3", "on_click")(); out.noRoot = short(trace());
    world.platform = "macos"; world.shared.clear(); calm();
    const apps = await overlayCopy({ tab: "open-in", overlay: "oi-1", menu: "menu-1", root: "/repo", target: { path: "a.js" } });
    world.exec = (cmd) => cmd === "osascript" ? { code: 0, stdout: "/Applications/Zed.app\n/Applications/Code.app\n", stdout2: "" } : { code: 0, stdout: "", stderr: "" };
    out.systemApps = renderNode(apps.view, apps.cx); await settle(); out.systemApps2 = renderNode(apps.view, apps.cx);
    handler("oi-0", "on_click")(); out.openApp = short(trace()); calm();
    handler("oi-customize", "on_click")(); await settle(); out.customize = short(trace()); calm();
    world.files.set("/home/open-in-apps.json", "[{\"label\":\"Mine\",\"app\":\"/A/Mine.app\"},{\"label\":\"\"},null]");
    const mine = await overlayCopy({ tab: "open-in", overlay: "oi-2", root: "/repo", target: { path: "a.js" } });
    renderNode(mine.view, mine.cx); await settle(); out.custom = renderNode(mine.view, mine.cx);
    handler("oi-customize", "on_click")(); await settle(); out.customizeExisting = short(trace()); calm();
    world.platform = "linux"; world.files.clear();
    const none = await overlayCopy({ tab: "open-in", overlay: "oi-3", target: undefined });
    renderNode(none.view, none.cx); await settle(); out.none = renderNode(none.view, none.cx);
    return out;
  },
  "the row menu shows its items by kind and opens the Open in flyout beside the row": async () => {
    const out = {};
    const menu = await overlayCopy(menuProps("src/i.js", false));
    out.file = renderNode(menu.view, menu.cx);
    world.props = menuProps("src", true); out.dir = renderNode(menu.view, menu.cx);
    world.platform = "windows"; out.windows = renderNode(menu.view, menu.cx);
    world.platform = "linux"; out.linux = renderNode(menu.view, menu.cx); world.platform = "macos";
    handler("fx-0", "on_click")({}, menu.cx); out.itemClick = { prompt: menu.view.prompt?.mode };
    menu.view.prompt = null;
    out.promptView = (() => { menu.view.prompt = { mode: "mv", title: "Rename", full: "/repo/x", overlay: "menu-1", value: "x", busy: false, error: "bad" }; const a = renderNode(menu.view, menu.cx); menu.view.prompt.busy = true; menu.view.prompt.error = null; return [a, renderNode(menu.view, menu.cx)]; })();
    handler("fx-cancel", "on_click")({}, menu.cx); out.cancelBusy = Boolean(menu.view.prompt);
    menu.view.prompt.busy = false; handler("fx-cancel", "on_click")({}, menu.cx); out.cancelled = menu.view.prompt;
    menu.view.prompt = { mode: "touch", title: "New File", full: "/repo", overlay: "menu-1", value: "", ...loc };
    renderNode(menu.view, menu.cx);
    const esc = handler(undefined, "on_key_down", "h_flex"); esc({ key: "x" }, menu.cx); esc({ key: "escape" }, menu.cx); out.escaped = menu.view.prompt;
    menu.view.prompt = { mode: "touch", title: "New File", full: "/repo", overlay: null, value: "", ...loc }; renderNode(menu.view, menu.cx);
    menu.view.input.set_value("made.txt");
    handler(undefined, "on_key_down", "Input.new")({ key: "x" }, menu.cx); const quiet = world.execLog.length;
    handler(undefined, "on_key_down", "Input.new")({ key: "enter" }, menu.cx); await settle(); out.enter = { quiet, execs: world.execLog.length > quiet, prompt: menu.view.prompt };
    menu.view.prompt = { mode: "touch", title: "New File", full: "/repo", overlay: null, value: "", ...loc }; renderNode(menu.view, menu.cx);
    handler("fx-save", "on_click")({}, menu.cx); await settle(); out.save = menu.view.prompt;
    menu.view.input.emit("submit", menu.cx); menu.view.input.emit("change", menu.cx);
    world.props = menuProps("src/i.js", false); calm();
    const track = handler("fx-8", "on_mouse_move"); renderNode(menu.view, menu.cx);
    const mover = handler("fx-8", "on_mouse_move"), other = handler("fx-0", "on_mouse_move");
    void track;
    mover({}); out.noEdge = { overlays: world.overlays.splice(0), shared: world.shared.get("orca-files.openIn") };
    world.shared.clear(); calm();
    const event = (x, w, y = 40) => ({ local_position: { x: 10, y: 5 }, position: { x, y: y + 5 }, bounds: { width: w } });
    const open = (e, viewport) => { world.shared.clear(); globalThis.window = viewport ? { viewport_size: () => viewport } : undefined; mover(e); const o = world.overlays.splice(0); world.sharedLog.length = 0; return short(o); };
    out.right = open(event(500, 250), { width: 1200, height: 800 });
    out.left = open(event(100, 250), { width: 1200, height: 800 });
    out.clamped = open(event(900, 250), { width: 700, height: 800 });
    out.noViewport = open(event(100, 250), undefined);
    out.partial = open({ local_position: null }, undefined);
    world.shared.set("orca-files.openIn", "flyout-1"); calm();
    mover(event(100, 250)); out.alreadyOpen = world.overlays.length;
    other({}); out.closeFlyout = { closed: world.closed.splice(0), shared: world.shared.get("orca-files.openIn") };
    handler("fx-8", "on_click")(); out.clickOpenWhenOpen = world.overlays.length;
    world.shared.clear(); handler("fx-8", "on_click")(); out.clickOpen = world.overlays.splice(0);
    menu.view.closeOpenIn(); out.closeNone = world.closed;
    globalThis.window = undefined;
    return out;
  },
});
