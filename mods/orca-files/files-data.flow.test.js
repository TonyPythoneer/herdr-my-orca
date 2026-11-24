import { world, settle, goldenSuite, fresh } from "./flow-harness.mjs";

// What the host answers for the tree: `tree` maps a folder to [kind, name] pairs, `status` is the porcelain text.
const listing = (entries) => entries.map(([kind, name]) => `${kind}\0${name}\0`).join("");
function listFolder(entries) {
  return { code: entries ? 0 : 1, stdout: listing(entries ?? []), stderr: "no such folder" };
}
function host({ tree = {}, top = "/repo\n", status = "", topCode = 0, statusCode = 0, files = "", rg = null, statusError = false } = {}) {
  return (cmd, args) => {
    if (cmd === "sh" && args[0] === "-c" && args[2] === "files") return listFolder(tree[args[3]]);
    if (cmd === "git" && args.includes("rev-parse")) return { code: topCode, stdout: top, stderr: "" };
    if (cmd === "git" && args.includes("status")) { if (statusError) throw new Error("git gone"); return { code: statusCode, stdout: status, stderr: "" }; }
    if (cmd === "git" && args.includes("ls-files")) return { code: 0, stdout: files, stderr: "" };
    if (cmd === "rg" && args.includes("--files")) return rg ?? { code: 2, stdout: "", stderr: "" };
    return { code: 0, stdout: "", stderr: "" };
  };
}
const entryKind = (entry) => {
  if (entry.dir) return "d";
  return entry.link ? "l" : "f";
};
const shape = (view) => ({ marks: view.marks, folderMarks: view.folderMarks, ignored: view.ignored, git: view.git, error: view.error, limited: view.limited, loading: view.loading,
  entries: [...view.entries].map(([folder, list]) => [folder, list.map((e) => `${entryKind(e)}:${e.name}`)]) });
const PORCELAIN = [" M sub/b.txt", "M  sub/a.md", "A  sub/src/new.js", "?? sub/src/untracked.txt", "!! sub/node_modules/", "R  sub/src/renamed.js", "sub/src/old.js",
  "C  sub/c.js", "sub/orig.js", " D sub/gone.txt", "UU sub/conflict.txt", "TM sub/typechg", "MM sub/both", "AD sub/addeldel", " M other/outside.txt", "!! sub/ignored-dir/", "D  sub/src/deep/removed.js", ""].join("\0");
const SUB = [["d", "src"], ["f", "b.txt"], ["f", "a.md"], ["f", "Z.txt"], ["l", "link"], ["d", "node_modules"], ["f", ".hidden"], ["d", "Apple"]];

goldenSuite("files-data", {
  "refresh reads the tree, git marks, folder marks and ignored paths relative to the space folder": async () => {
    const { view, cx } = await fresh(() => {
      world.spaces = [{ id: "s1", active: true, folder: "/repo/sub", machine: null }];
      world.exec = host({ tree: { "/repo/sub": SUB, "/repo/sub/src": [["f", "index.js"], ["d", "lib"]] }, status: PORCELAIN });
    });
    view.toggle("src", cx); await settle();
    view.refresh(cx); await settle();
    return { ...shape(view), watched: view.watched, watchers: world.watchers.length, execs: world.execLog.map(([c, a]) => [c, a.filter((x) => !x.startsWith("n=0"))]) };
  },
  "refresh outside a git repository, with a failing status call, and with a folder that cannot be listed": async () => {
    const out = {};
    const a = await fresh(() => { world.exec = host({ tree: { "/repo": [["f", "x"]] }, topCode: 128 }); });
    out.nonGit = shape(a.view);
    const b = await fresh(() => { world.exec = host({ tree: { "/repo": [["f", "x"]] }, statusError: true }); });
    out.statusFails = shape(b.view);
    const c = await fresh(() => { world.exec = host({ tree: { "/repo": [["f", "x"]] }, statusCode: 128 }); });
    out.statusCode = shape(c.view);
    const d = await fresh(() => { world.exec = host({ tree: {} }); });
    out.unlistable = shape(d.view);
    const e = await fresh(() => { world.spaces = []; });
    out.noSpace = { ...shape(e.view), context: e.view.context };
    const f = await fresh(() => { world.exec = host({ tree: { "/repo": [["f", "x"]] }, top: "" }); });
    out.noTop = shape(f.view);
    const g = await fresh(() => { world.exec = (cmd) => { if (cmd === "git") throw new Error("no git"); return { code: 0, stdout: listing([["f", "x"]]), stderr: "" }; }; });
    out.gitMissing = shape(g.view);
    return out;
  },
  "refresh caps a folder at 500 entries and the whole tree at 5000, and says the list was limited": async () => {
    const many = (n, prefix) => Array.from({ length: n }, (_, i) => ["f", `${prefix}${String(i).padStart(4, "0")}`]);
    const { view, cx } = await fresh(() => { world.exec = host({ tree: { "/repo": [["d", "d0"], ["d", "d1"], ["d", "d2"], ["d", "d3"], ["d", "d4"], ["d", "d5"], ["d", "d6"], ["d", "d7"], ["d", "d8"], ["d", "d9"], ["d", "d10"], ...many(490, "r")],
      ...Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`/repo/d${i}`, many(500, "f")])) } }); });
    const first = { limited: view.limited, counts: [...view.entries].map(([k, l]) => [k, l.length]) };
    for (let i = 0; i < 11; i++) view.toggle(`d${i}`, cx);
    await settle(); view.refresh(cx); await settle();
    const wide = await fresh(() => { world.exec = host({ tree: { "/repo": many(501, "w") } }); });
    return { first, limited: view.limited, counts: [...view.entries].map(([k, l]) => [k, l.length]), wideLimited: wide.view.limited, wideCount: wide.view.entries.get("").length };
  },
  "directory listing on a machine without sh falls back to PowerShell, and windows lists locally with PowerShell": async () => {
    const out = {};
    const a = await fresh(() => {
      world.spaces = [{ id: "s1", active: true, folder: "C:/repo's", machine: "m1" }];
      world.exec = (cmd, args, options) => {
        if (cmd === "sh") throw new Error("cannot start sh: program not found");
        if (cmd === "powershell") return { code: 0, stdout: JSON.stringify([{ name: "docs", dir: true, link: false }, { name: "a.txt", dir: false, link: false }]), stderr: "" };
        return { code: 1, stdout: "", stderr: "" };
      };
    });
    out.remote = { entries: shape(a.view).entries, calls: world.execLog.filter(([c]) => c === "powershell").map(([, args, options]) => [args.slice(0, 2), args[2].slice(-24), options]) };
    const b = await fresh(() => {
      world.platform = "windows";
      world.exec = (cmd) => cmd === "powershell" ? { code: 0, stdout: JSON.stringify({ name: "only", dir: false, link: true }), stderr: "" } : { code: 1, stdout: "", stderr: "" };
    });
    out.local = shape(b.view).entries;
    const c = await fresh(() => { world.platform = "windows"; world.exec = (cmd) => cmd === "powershell" ? { code: 0, stdout: "", stderr: "" } : { code: 1, stdout: "", stderr: "" }; });
    out.empty = shape(c.view).entries;
    const d = await fresh(() => { world.platform = "windows"; world.exec = (cmd) => cmd === "powershell" ? { code: 1, stdout: "", stderr: "denied" } : { code: 1, stdout: "", stderr: "" }; });
    out.failed = d.view.error;
    const e = await fresh(() => { world.spaces = [{ id: "s1", active: true, folder: "/r", machine: "m1" }]; world.exec = () => { throw new Error("other failure"); }; });
    out.remoteFailure = e.view.error;
    return out;
  },
  "toggle opens and closes folders and keeps errors per folder": async () => {
    const { view, cx } = await fresh(() => { world.exec = host({ tree: { "/repo": [["d", "a"], ["d", "b"]], "/repo/a": [["d", "inner"]], "/repo/a/inner": [["f", "x"]] } }); });
    view.toggle("a", cx); await settle(); view.toggle("a/inner", cx); await settle();
    const opened = { folders: view.folders, entries: shape(view).entries, pending: view.pending };
    view.toggle("a", cx);
    const closed = { folders: view.folders, entries: shape(view).entries };
    view.toggle("b", cx); await settle();
    const failing = { folders: view.folders, errors: view.folderErrors, pending: view.pending };
    view.collapseAll(cx);
    view.collapseAll(cx);
    return { opened, closed, failing, collapsed: { folders: view.folders, entries: shape(view).entries } };
  },
  "collapseAll does nothing in the search view or under a name filter": async () => {
    const { view, cx } = await fresh();
    view.folders.add("a");
    view.view = "search"; view.collapseAll(cx);
    const search = [...view.folders];
    view.view = "files"; view.name.set_value("x"); view.collapseAll(cx);
    return { search, filtered: [...view.folders] };
  },
  "switching workspace saves the open folders and file, resets search state and reopens the saved file": async () => {
    const { view, cx } = await fresh(() => { world.files.set("/repo/a.txt", "alpha"); world.files.set("/two/b.txt", "beta"); world.exec = host({ tree: { "/repo": [["f", "a.txt"]], "/two": [["f", "b.txt"]] } }); });
    view.folders.add("kept"); view.show("a.txt", cx); await settle();
    view.caseSensitive = true; view.include.set_value("*.js"); view.filtersOpen = true; view.hits = { files: [] }; view.collapsedSearch.add("x");
    world.spaces = [{ id: "s2", active: true, folder: "/two", machine: null }];
    view.refresh(cx); await settle();
    const second = { root: view.root, file: view.file, folders: view.folders, caseSensitive: view.caseSensitive, include: view.include.value(), open: view.filtersOpen, hits: view.hits, collapsed: view.collapsedSearch, saved: [...view.saved.keys()] };
    world.spaces = [{ id: "s1", active: true, folder: "/repo", machine: null }];
    view.refresh(cx); await settle();
    return { second, back: { root: view.root, file: view.file, folders: view.folders, code: view.code?.value(), doc: view.doc?.full } };
  },
  "a file named by props opens once when the workspace first loads": async () => {
    const { view, cx } = await fresh(() => { world.files.set("/repo/start.txt", "hello"); world.props = { file: "start.txt" }; });
    const first = { file: view.file, text: view.code?.value(), propFile: view.propFile };
    view.refresh(cx); await settle();
    world.props = {};
    return { first, file: view.file };
  },
  "the name filter lists files matching every token, keeps ancestors and honours dotfile, ignored and deleted rules": async () => {
    const files = ["src/a.js", "src/lib/b.js", ".hidden/c.js", "README.md", "docs/Readme.txt", "ignored/x.js", "deleted.js", ".git/config", ".git", "src/.env.js", "", "."].join("\0");
    const { view, cx } = await fresh(() => { world.exec = host({ tree: { "/repo": [] }, status: " D deleted.js\0!! ignored/\0", files }); });
    const out = {};
    const project = async (query, filters) => {
      world.shared.set("orca-files.filters", filters);
      view.name.set_value(query);
      await view.nameMatches(cx);
      return { map: view.nfMap, loading: view.nfLoading };
    };
    out.js = await project("JS src", undefined);
    out.noDot = await project("js", { "/repo": { dotfiles: false } });
    out.noIgnored = await project("js", { "/repo": { ignored: false } });
    out.none = await project("zzz", undefined);
    out.blank = await project("   ", undefined);
    out.long = await project("a".repeat(2049), undefined);
    out.readme = await project("readme", undefined);
    view.names = null; view.git = false;
    world.exec = host({ rg: { code: 2, stdout: "./src/a.js\0docs/x.js\0", stderr: "" } });
    out.rg = await project("js", undefined);
    view.names = null;
    world.exec = host({ rg: { code: 2, stdout: "", stderr: "" } });
    out.rgEmpty = await project("js", undefined);
    view.names = null; view.root = null; out.noRoot = await project("js", undefined);
    return { out, execs: world.execLog.filter(([c, a]) => (c === "git" && a.includes("ls-files")) || c === "rg").map(([c, a, o]) => [c, a, o]) };
  },
  "the name filter reuses its cached listing for the same root and drops it on refresh": async () => {
    const { view, cx } = await fresh(() => { world.exec = host({ tree: { "/repo": [] }, files: "a.js\0b.js\0" }); });
    view.name.set_value("a"); await view.nameMatches(cx);
    const lists = () => world.execLog.filter(([c, a]) => c === "git" && a.includes("ls-files")).length;
    const one = lists();
    view.name.set_value("b"); await view.nameMatches(cx);
    const same = lists();
    view.refresh(cx); await settle();
    return { one, same, afterRefresh: lists(), names: view.names, nfMap: view.nfMap };
  },
  "scheduleName clears an empty filter at once and debounces a typed one by 200 ms": async () => {
    const { view, cx } = await fresh(() => { world.exec = host({ tree: { "/repo": [] }, files: "a.js\0" }); });
    view.nfMap = new Map([["", []]]); view.nfLoading = true;
    view.scheduleName(cx);
    const empty = { map: view.nfMap, loading: view.nfLoading, collapsed: view.nfCollapsed };
    view.name.set_value("a");
    const before = world.timers.length;
    view.scheduleName(cx); view.scheduleName(cx);
    const timers = world.timers.slice(before).map((t) => [t.ms, t.cancelled]);
    await world.timers.at(-1).fn(cx); await settle();
    return { empty, timers, map: view.nfMap, loading: view.nfLoading };
  },
  "editing the Names input blanks the projection, shows the spinner and schedules the filter": async () => {
    const { view, cx } = await fresh();
    view.nfMap = new Map(); view.name.set_value("q");
    view.name.emit("change", cx);
    const typed = { map: view.nfMap, loading: view.nfLoading, timers: world.timers.filter((t) => t.ms === 200).length };
    view.name.set_value(""); view.name.emit("change", cx);
    return { typed, cleared: { loading: view.nfLoading } };
  },
  "a stale name match is dropped when the query or workspace moved on": async () => {
    const { view, cx } = await fresh(() => { world.exec = host({ tree: { "/repo": [] }, files: "a.js\0" }); });
    view.name.set_value("a");
    const run = view.nameMatches(cx);
    view.name.set_value("b");
    await run;
    return { map: view.nfMap, loading: view.nfLoading };
  },
  "nameToggle collapses and reopens a filtered branch": async () => {
    const { view, cx } = await fresh();
    view.nameToggle("a", cx); const closed = [...view.nfCollapsed];
    view.nameToggle("a", cx);
    return { closed, open: [...view.nfCollapsed] };
  },
  "flat walks the loaded folders or the name projection, hides dotfiles and ignored paths and stops at the limits": async () => {
    const { view } = await fresh();
    view.entries = new Map([["", [{ name: "d", dir: true }, { name: ".dot", dir: false }, { name: "ig", dir: true }, { name: "..", dir: false }, { name: "l", dir: false, link: true }, { name: ".", dir: false }]],
      ["d", [{ name: "x", dir: false }, { name: ".y", dir: false }]], ["ig", [{ name: "z", dir: false }]]]);
    view.folders = new Set(["d", "ig"]); view.git = true; view.ignored = new Set(["ig"]);
    const rows = (list) => list.map((r) => [r.path, r.depth, r.open, r.dir, r.link]);
    const out = { all: rows(view.flat("", 0, [], undefined)) };
    world.shared.set("orca-files.filters", { "/repo": { dotfiles: false, ignored: false } });
    out.filtered = rows(view.flat("", 0, [], undefined));
    view.nfMap = new Map([["", [{ name: "n", dir: true }, { name: ".h", dir: false }]], ["n", [{ name: "m", dir: false }]]]); view.nfCollapsed = new Set();
    out.named = rows(view.flat("", 0, [], "name"));
    view.nfCollapsed = new Set(["n"]);
    out.namedCollapsed = rows(view.flat("", 0, [], "name"));
    out.deep = view.flat("", 41, [], undefined).length;
    out.full = view.flat("", 0, new Array(5000).fill(0), undefined).length;
    view.entries = new Map([["", Array.from({ length: 5100 }, (_, i) => ({ name: `f${i}`, dir: false }))]]);
    out.capped = view.flat("", 0, [], undefined).length;
    return out;
  },
  "isGitIgnored matches the path or any ancestor only inside a repository": async () => {
    const { view } = await fresh();
    view.ignored = new Set(["a/b"]); view.git = true;
    const probe = () => ["a/b", "a/b/c/d", "a", "a/bc", "z"].map((p) => view.isGitIgnored(p));
    const git = probe(); view.git = false; const plain = probe(); view.git = true; view.ignored = new Set(); const none = probe();
    return { git, plain, none };
  },
  "repo names the last folder of the root": async () => {
    const { view } = await fresh();
    const out = [];
    for (const root of ["/a/b/", "C:\\x\\y\\", "/", null, "name"]) { view.root = root; out.push(view.repo()); }
    return { out };
  },
  "search builds the rg command from the toggles and the include and exclude globs": async () => {
    const { view } = await fresh(() => { world.exec = (cmd) => cmd === "rg" ? { code: 0, stdout: "", stderr: "" } : { code: 1, stdout: "", stderr: "" }; });
    const out = [];
    const ask = async (setup) => {
      view.caseSensitive = false; view.wholeWord = false; view.useRegex = false; setup?.();
      world.execLog.length = 0; await view.search("q"); out.push(world.execLog.at(-1));
    };
    await ask();
    await ask(() => { view.caseSensitive = true; view.wholeWord = true; view.useRegex = true; });
    for (const globs of ["*.ts, src/**", "{a,b}.js,c", "[a,b]c,d", "[!x,y],z", "[^x,y],z", "a\\,b,c", "x\\", " , ,e, ", "{a,{b,c}},d", "}x,y", "[]a,b],c", "[a", "[[:alpha:],]z"]) {
      await ask(() => { view.include.set_value(globs); view.exclude.set_value(`not-${globs}`); });
    }
    return { out, empty: await view.search("") };
  },
  "search groups rg vimgrep lines by file, counts every hit and keeps 200 for display": async () => {
    const { view } = await fresh();
    const lines = [];
    for (let i = 0; i < 210; i++) lines.push(`${i % 2 ? "b.js" : "a.js"}:${i + 1}:${i % 3 ? i : ""}:text: with colon ${i}`);
    world.exec = () => ({ code: 0, stdout: ["x.js:3:1: hello ", "bad-line", ":4:5:no file", "y.js::3:no line", ...lines, ""].join("\n"), stderr: "" });
    const big = await view.search("q");
    world.exec = () => ({ code: 2, stdout: "p.js:1:2:partial\n", stderr: "denied" });
    const partial = await view.search("q");
    world.exec = () => ({ code: 2, stdout: "", stderr: "denied" });
    const failed = await view.search("q");
    world.exec = () => { throw new Error("no rg"); };
    const missing = await view.search("q");
    return { summary: { total: big.totalMatches, fileCount: big.fileCount, truncated: big.truncated, shown: big.files.map((f) => [f.path, f.matches.length]) },
      first: big.files[0].matches.slice(0, 3), partial, failed, missing };
  },
  "rerun debounces the Contents query by 200 ms and drops results from an older query": async () => {
    const { view, cx } = await fresh(() => { world.exec = (cmd, args) => cmd === "rg" ? { code: 0, stdout: `${args.at(-1)}.js:1:1:t\n`, stderr: "" } : { code: 1, stdout: "", stderr: "" }; });
    view.q.set_value("one"); view.rerun(cx);
    const waiting = { searching: view.searching, hits: view.hits };
    const first = world.timers.at(-1);
    view.q.set_value("two"); view.rerun(cx);
    const cancelled = first.cancelled;
    await world.timers.at(-1).fn(cx); await settle();
    const done = { searching: view.searching, files: view.hits.files.map((f) => f.path), timer: view.searchTimer };
    view.q.set_value(""); view.rerun(cx);
    const cleared = { hits: view.hits, searching: view.searching, collapsed: view.collapsedSearch };
    view.q.set_value("three"); view.rerun(cx);
    const timer = world.timers.at(-1); view.searchGeneration++;
    await timer.fn(cx); await settle();
    return { waiting, cancelled, done, cleared, stale: { searching: view.searching, hits: view.hits } };
  },
  "the Contents input reruns on change and paints a ring while focused; filter inputs rerun too": async () => {
    const { view, cx } = await fresh();
    view.q.set_value("x"); view.q.emit("change", cx);
    view.include.set_value("a"); view.include.emit("change", cx);
    view.exclude.emit("change", cx);
    view.q.emit("focus", cx); const focused = view.qFocused;
    view.q.emit("blur", cx);
    view.input.emit("change", cx);
    return { timers: world.timers.filter((t) => t.ms === 200).length, focused, blurred: view.qFocused };
  },
});
