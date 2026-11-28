import { createHash } from "node:crypto";
import { goldenSuite } from "../../support/golden.ts";
import { mutateFile } from "../../../mods/orca-files/file-mutation.js";
import { deleteTarget } from "../../../mods/orca-files/delete-target.js";
import { resolveTreeKey, parentIndex } from "../../../mods/orca-files/tree-nav.js";
import { canEditPath, writeEditorFile } from "../../../mods/orca-files/editor-path.js";

const sha = (text) => createHash("sha1").update(text).digest("hex").slice(0, 10);
// Runs `fn` against a recording exec: an error message, or the call with its shell script reduced to a hash.
async function observe(fn, reply = { code: 0, stdout: "", stderr: "" }) {
  const calls = [];
  const exec = async (cmd, args, options) => { calls.push([cmd, args.map((a, i) => (i === 1 && cmd === "sh" ? `script:${sha(a)}` : a)), options]); if (reply instanceof Error) throw reply; return reply; };
  try { const value = await fn(exec); return { ok: true, value, calls }; } catch (e) { return { error: e.message, calls }; }
}

const cur = { cwd: "/repo", on: null, space: "s" };
const mut = (over, name = "new.txt", current = cur) => observe((exec) => mutateFile({ ...cur, mode: "touch", full: "/repo/src", ...over }, current, name, exec));

goldenSuite("files-pure", {
  "mutateFile validates the workspace, the name, the mode and the paths before it runs anything": async () => {
    const out = {};
    out.noTarget = await observe((exec) => mutateFile(null, cur, "x", exec));
    out.noCwd = await mut({ cwd: "" });
    out.noSpace = await mut({ space: "" });
    out.otherSpace = await mut({}, "x", { ...cur, space: "t" });
    out.otherHost = await mut({ on: "m" });
    out.sameHost = await mut({ on: "m" }, "x", { ...cur, on: "m" });
    for (const name of [null, "", "   ", ".", "..", "a/b", "a\\b", "a\0b"]) out[`name ${JSON.stringify(name)}`] = await mut({}, name);
    out.badMode = await mut({ mode: "rm" });
    for (const mode of ["touch", "mkdir"]) {
      out[`${mode} root`] = await mut({ mode, full: "/repo" });
      out[`${mode} nested`] = await mut({ mode, full: "/repo/a/b" });
      out[`${mode} outside`] = await mut({ mode, full: "/other" });
      out[`${mode} dot`] = await mut({ mode, full: "/repo/a/../b" });
      out[`${mode} dotdot end`] = await mut({ mode, full: "/repo/a/.." });
      out[`${mode} empty part`] = await mut({ mode, full: "/repo/a//b" });
      out[`${mode} single dot`] = await mut({ mode, full: "/repo/./b" });
      out[`${mode} prefix lookalike`] = await mut({ mode, full: "/repository" });
    }
    out.rootCwd = await mut({ cwd: "/", full: "/" }, "x", { ...cur, cwd: "/" });
    out.rootCwdNested = await mut({ cwd: "/", full: "/a" }, "x", { ...cur, cwd: "/" });
    out.trailingSlashCwd = await mut({ cwd: "/repo///", full: "/repo/a" }, "x", { ...cur, cwd: "/repo///" });
    return out;
  },
  "mutateFile moves and duplicates only a real file under the workspace": async () => {
    const out = {};
    for (const mode of ["mv", "duplicate"]) {
      const name = mode === "mv" ? "renamed.txt" : "a.txt";
      out[`${mode} ok`] = await mut({ mode, full: "/repo/src/a.txt" }, name);
      out[`${mode} top`] = await mut({ mode, full: "/repo/a.txt" }, name);
      out[`${mode} no extension`] = await mut({ mode, full: "/repo/src/a" }, mode === "mv" ? "b" : "a");
      out[`${mode} dotfile`] = await mut({ mode, full: "/repo/src/.rc" }, mode === "mv" ? ".new" : ".rc");
      out[`${mode} two dots`] = await mut({ mode, full: "/repo/src/a.tar.gz" }, mode === "mv" ? "b.tar.gz" : "a.tar.gz");
      out[`${mode} trailing slash`] = await mut({ mode, full: "/repo/src/" }, name);
      out[`${mode} the root`] = await mut({ mode, full: "/repo" }, name);
      out[`${mode} outside`] = await mut({ mode, full: "/other/a.txt" }, name);
      out[`${mode} prefix lookalike`] = await mut({ mode, full: "/repository/a.txt" }, name);
      out[`${mode} dot parent`] = await mut({ mode, full: "/repo/../a.txt" }, name);
    }
    out.duplicateWrongName = await mut({ mode: "duplicate", full: "/repo/src/a.txt" }, "b.txt");
    out.failure = await observe((exec) => mutateFile({ ...cur, mode: "touch", full: "/repo" }, cur, "n", exec), { code: 1, stdout: "", stderr: " exists \n" });
    out.failureStdout = await observe((exec) => mutateFile({ ...cur, mode: "touch", full: "/repo" }, cur, "n", exec), { code: 1, stdout: "out", stderr: "" });
    out.failureEmpty = await observe((exec) => mutateFile({ ...cur, mode: "touch", full: "/repo" }, cur, "n", exec), { code: 2, stdout: "", stderr: "" });
    out.onHost = await observe((exec) => mutateFile({ ...cur, on: "m", mode: "mkdir", full: "/repo/a" }, { ...cur, on: "m" }, "n", exec));
    return out;
  },
  "deleteTarget validates the workspace and the path, then removes through one shell call": async () => {
    const out = {};
    const del = (over, current = cur, reply) => observe((exec) => deleteTarget({ ...cur, path: "/repo/a/b.txt", ...over }, current, exec), reply);
    out.none = await observe((exec) => deleteTarget(null, cur, exec));
    out.noCwd = await del({ cwd: "" });
    out.noSpace = await del({ space: "" });
    out.noPath = await del({ path: "" });
    out.otherSpace = await del({}, { ...cur, space: "t" });
    out.otherHost = await del({ on: "m" });
    out.ok = await del({});
    out.top = await del({ path: "/repo/b.txt" });
    out.onHost = await observe((exec) => deleteTarget({ ...cur, on: "m", path: "/repo/x" }, { ...cur, on: "m" }, exec));
    out.outside = await del({ path: "/other/b.txt" });
    out.root = await del({ path: "/repo" });
    out.rootSlash = await del({ path: "/repo/" });
    out.dots = await del({ path: "/repo/a/../b" });
    out.dot = await del({ path: "/repo/./b" });
    out.empty = await del({ path: "/repo/a//b" });
    out.slashRoot = await del({ cwd: "/", path: "/a" }, { ...cur, cwd: "/" });
    out.slashRootOutside = await del({ cwd: "/", path: "a" }, { ...cur, cwd: "/" });
    out.failed = await del({}, cur, { code: 1, stdout: "", stderr: " gone \n" });
    out.failedStdout = await del({}, cur, { code: 1, stdout: "out", stderr: "" });
    out.failedEmpty = await del({}, cur, { code: 1, stdout: "", stderr: "" });
    return out;
  },
  "resolveTreeKey maps every key for no selection, files, open and closed folders": async () => {
    const rows = [
      { path: "a", dir: true, depth: 0, open: true }, { path: "a/b", dir: false, depth: 1, open: false }, { path: "a/c", dir: true, depth: 1, open: false },
      { path: "d", dir: true, depth: 0, open: true }, { path: "e", dir: false, depth: 0, open: false },
    ];
    const many = Array.from({ length: 35 }, (_, i) => ({ path: `f${i}`, dir: false, depth: 0, open: false }));
    const keys = ["arrowdown", "arrowup", "home", "end", "pagedown", "pageup", "arrowright", "arrowleft", "space", "enter", "x"];
    const out = {};
    for (const key of keys) {
      out[`${key} none`] = [null, undefined, 0, 1, 2, 3, 4, 9].map((current) => resolveTreeKey(key, current, rows));
      out[`${key} many`] = [0, 10, 17, 34].map((current) => resolveTreeKey(key, current, many));
      out[`${key} empty`] = resolveTreeKey(key, null, []);
      out[`${key} empty current`] = resolveTreeKey(key, 0, []);
    }
    out.parents = [0, 1, 2, 3, 4].map((i) => parentIndex(rows, i)).concat([parentIndex([], 0)]);
    return out;
  },
  "canEditPath and writeEditorFile accept only a plain file under the workspace": async () => {
    const out = {};
    const check = (root, full, reply) => observe((exec) => canEditPath(root, full, exec), reply);
    for (const [root, full] of [["/repo", "/repo/a.txt"], ["/repo/", "/repo/a/b.txt"], ["/", "/a.txt"], ["/repo", "/repo"], ["/repo", "/repo/"], ["/repo", "/other/a"], ["/repo", "/repo/../a"], ["/repo", "/repo/./a"], ["/repo", "/repo/a//b"],
      ["repo", "/repo/a"], ["/repo", "repo/a"], [null, "/a"], ["/a", 3], ["/repo", "/repository/x"]]) out[`${root} ${full}`] = await check(root, full);
    out.refused = await check("/repo", "/repo/a", { code: 1, stdout: "", stderr: "" });
    out.throws = await check("/repo", "/repo/a", new Error("no sh"));
    const calls = [];
    const write = async (...args) => { calls.push(args); return "written"; };
    out.write = await observe(async (exec) => writeEditorFile({ root: "/repo", full: "/repo/a" }, "text", "disk", exec, write));
    out.writeRefused = await observe(async (exec) => writeEditorFile({ root: "/repo", full: "/other/a" }, "text", "disk", exec, write));
    out.writes = calls;
    return out;
  },
}, new URL(".", import.meta.url));
