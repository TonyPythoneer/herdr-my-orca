import { goldenSuite } from "./golden.mjs";
import { loadDiff } from "./diff-data.js";
import { diffRows, diffLines, diffWidth, untrackedPreview } from "./diff-rows.js";

const READ_LENGTH = 8; // the fixed `--no-optional-locks … core.quotepath=false` prefix every git call starts with
const ok = (stdout = "", code = 0, stderr = "") => ({ code, stdout, stderr });
const HUNK = "diff --git a/f b/f\nindex 1..2 100644\n--- a/f\n+++ b/f\n@@ -1,2 +1,2 @@\n-old\n+new\n ctx\n";
const NEW_EMPTY = "diff --git a/e b/e\nnew file mode 100644\nindex 0000000..e69de29\n";
const BINARY = "diff --git a/b b/b\nBinary files a/b and b/b differ\n";

// A fake git: `reply` answers by sub-command, and every call is kept (without the fixed option prefix).
async function run(target, reply) {
  const calls = [];
  const exec = async (cmd, args, options) => {
    const rest = args.slice(READ_LENGTH);
    calls.push([cmd, rest, options]);
    const kind = rest[0];
    return typeof reply === "function" ? reply(kind, rest) : (reply[kind] ?? ok());
  };
  try { return { lines: await loadDiff(target, exec), calls }; } catch (e) { return { error: e.message, calls }; }
}
const summary = (result) => result.lines ? { ...result, lines: result.lines.length > 40 ? [...result.lines.slice(0, 5), `[${result.lines.length} lines]`, ...result.lines.slice(-3)] : result.lines } : result;
const base = { root: "/r", on: "host" };
const statusOf = (...entries) => ok(entries.join("\0") + "\0");

goldenSuite("diff-data", {
  "a single file diff reads one path, staged, unstaged or untracked": async () => {
    const out = {};
    out.unstaged = await run({ ...base, path: "f" }, { diff: ok(HUNK) });
    out.staged = await run({ ...base, path: "f", section: "staged" }, { diff: ok(HUNK) });
    out.untracked = await run({ ...base, path: "f", status: "U" }, { diff: ok(HUNK.replace("@@ -1,2", "@@ -0,0"), 1) });
    out.untrackedEmpty = await run({ ...base, path: "e", status: "U" }, { diff: ok("", 1) });
    out.untrackedEmptyNewFile = await run({ ...base, path: "e", status: "U" }, { diff: ok(NEW_EMPTY, 1) });
    out.untrackedBinary = await run({ ...base, path: "b", status: "U" }, { diff: ok(BINARY.replace("diff --git a/b b/b\n", "diff --git a/b b/b\nnew file mode 100644\n"), 1) });
    out.untrackedError = await run({ ...base, path: "e", status: "U" }, { diff: ok("", 1, " vanished ") });
    out.untrackedFailed = await run({ ...base, path: "e", status: "U" }, { diff: ok("", 128, "fatal") });
    out.unstagedEmpty = await run({ ...base, path: "f" }, { diff: ok("") });
    out.unstagedBinary = await run({ ...base, path: "b" }, { diff: ok(BINARY) });
    out.failed = await run({ ...base, path: "f" }, { diff: ok("", 128, "fatal: bad") });
    out.failedBare = await run({ ...base, path: "f" }, { diff: ok("", 2) });
    out.stagedFailedOneIsError = await run({ ...base, path: "f", section: "staged" }, { diff: ok("", 1) });
    return out;
  },
  "all changes shows HEAD, or staged and unstaged separately before the first commit, plus a bounded untracked preview": async () => {
    const out = {};
    const untracked = (n) => ok(Array.from({ length: n }, (_, i) => `u${i}`).join("\0") + "\0");
    out.committed = summary(await run({ ...base, all: true }, { "ls-files": untracked(0), "rev-parse": ok("abc\n"), diff: ok(HUNK) }));
    out.clean = await run({ ...base, all: true }, { "ls-files": untracked(0), "rev-parse": ok("abc\n") });
    out.unborn = await run({ ...base, all: true }, { "ls-files": untracked(1), "rev-parse": ok("", 1), diff: ok(HUNK) });
    out.unbornDiffs = summary(await run({ ...base, all: true }, { "ls-files": untracked(0), "rev-parse": ok("", 1), diff: ok(HUNK) }));
    const withUntracked = (count, preview, tracked = ok("")) => (kind, args) => {
      if (kind === "ls-files") return untracked(count);
      if (kind === "rev-parse") return ok("abc");
      return args.includes("--no-index") ? preview : tracked;
    };
    out.manyUntracked = summary(await run({ ...base, all: true }, withUntracked(23, ok(HUNK, 1))));
    out.untrackedEmptyFile = await run({ ...base, all: true }, withUntracked(2, ok("", 1)));
    out.untrackedEmptyError = await run({ ...base, all: true }, withUntracked(1, ok("", 1, "gone")));
    out.untrackedNewFileMode = await run({ ...base, all: true }, withUntracked(1, ok(NEW_EMPTY, 1)));
    out.lsFailed = await run({ ...base, all: true }, { "ls-files": ok("", 128, "no repo") });
    out.lsFailedBare = await run({ ...base, all: true }, { "ls-files": ok("", 1) });
    out.headFailed = await run({ ...base, all: true }, { "ls-files": untracked(0), "rev-parse": ok("", 2, "bad head") });
    out.headFailedBare = await run({ ...base, all: true }, { "ls-files": untracked(0), "rev-parse": ok("", 3) });
    out.diffFailed = await run({ ...base, all: true }, { "ls-files": untracked(0), "rev-parse": ok("abc"), diff: ok("", 128, "oops") });
    const long = (n) => ok("diff --git a/f b/f\n@@ -1 +1 @@\n" + Array.from({ length: n }, (_, i) => `+line ${i}`).join("\n") + "\n");
    out.cut = summary(await run({ ...base, all: true }, { "ls-files": untracked(0), "rev-parse": ok("abc"), diff: long(6000) }));
    out.cutAcross = summary(await run({ ...base, all: true }, withUntracked(3, ok(long(2400).stdout, 1), ok(HUNK))));
    return out;
  },
  "a section diff is limited to the selected paths and skips conflicts and unrelated entries": async () => {
    const out = {};
    const paths = ["a", "b", "c", "d", "e", "f"];
    const status = statusOf(" M a", "M  b", "?? c", "UU d", "AA e", "DD f", " M unrelated", "MM g");
    const reply = (kind, rest) => {
      if (kind === "status") return status;
      return ok(HUNK, rest.includes("--no-index") ? 1 : 0);
    };
    out.changes = summary(await run({ ...base, sectionAll: true, section: "changes", paths }, reply));
    out.staged = summary(await run({ ...base, sectionAll: true, section: "staged", paths }, reply));
    out.limited = summary(await run({ ...base, sectionAll: true, section: "changes", paths: ["a"], limited: true }, reply));
    out.nothing = await run({ ...base, sectionAll: true, section: "changes", paths: ["x"] }, { status: ok("") });
    out.emptyFile = await run({ ...base, sectionAll: true, section: "changes", paths: ["c"] }, { status: statusOf("?? c"), diff: ok("", 1) });
    out.dedup = summary(await run({ ...base, sectionAll: true, section: "changes", paths: ["a", "a"] }, reply));
    out.becameDirectory = await run({ ...base, sectionAll: true, section: "changes", paths: ["a"] }, { status: statusOf("?? a/inner") });
    out.otherUnselected = await run({ ...base, sectionAll: true, section: "changes", paths: ["a"] }, { status: statusOf("?? other") });
    out.statusFailed = await run({ ...base, sectionAll: true, section: "changes", paths: ["a"] }, { status: ok("", 128, "bad index") });
    out.statusFailedBare = await run({ ...base, sectionAll: true, section: "changes", paths: ["a"] }, { status: ok("", 1) });
    out.untrackedInStaged = await run({ ...base, sectionAll: true, section: "staged", paths: ["c"] }, { status: statusOf("?? c") });
    out.stagedAdded = summary(await run({ ...base, sectionAll: true, section: "staged", paths: ["n"] }, { status: statusOf("A  n"), diff: ok(HUNK) }));
    out.stagedUnstagedOnly = await run({ ...base, sectionAll: true, section: "staged", paths: ["n"] }, { status: statusOf(" M n") });
    out.changesStagedOnly = await run({ ...base, sectionAll: true, section: "changes", paths: ["n"] }, { status: statusOf("M  n") });
    out.changesIgnoredQ = await run({ ...base, sectionAll: true, section: "changes", paths: ["n"] }, { status: statusOf("M? n") });
    for (const [name, target] of Object.entries({ badSection: { section: "other", paths: ["a"] }, noPaths: { section: "staged" }, notArray: { section: "staged", paths: "a" }, empty: { section: "staged", paths: [""] }, nul: { section: "staged", paths: ["a\0b"] }, number: { section: "staged", paths: [1] } })) {
      out[name] = await run({ ...base, sectionAll: true, ...target }, {});
    }
    const many = Array.from({ length: 450 }, (_, i) => `file-${i}`);
    out.batched = summary(await run({ ...base, sectionAll: true, section: "changes", paths: many }, (kind) => kind === "status" ? ok("") : ok()));
    const wide = Array.from({ length: 30 }, (_, i) => `${"長".repeat(1800)}${i}`);
    out.batchedByBytes = (await run({ ...base, sectionAll: true, section: "changes", paths: wide }, (kind) => kind === "status" ? ok("") : ok())).calls.map(([, rest]) => rest.length);
    out.fileBatches = (await run({ ...base, sectionAll: true, section: "changes", paths: many }, (kind, rest) => kind === "status" ? statusOf(...rest.slice(rest.indexOf("--") + 1).map((p) => ` M ${p}`)) : ok(HUNK))).calls.filter(([, rest]) => rest[0] === "diff").map(([, rest]) => rest.length);
    return out;
  },
  "diffLines keeps the hunks, binary notes and a bounded length; diffRows numbers the lines": async () => {
    const out = {};
    out.empty = diffLines("");
    out.headerOnly = diffLines("diff --git a/f b/f\nindex 1..2\n");
    out.hunk = diffLines(HUNK);
    out.withFiles = diffLines(`${HUNK}${BINARY}${HUNK}`, { files: true });
    out.withoutFiles = diffLines(`${HUNK}${BINARY}${HUNK}`);
    out.binary = diffLines("Binary files a and b differ\n");
    out.gitBinary = diffLines("diff --git a/b b/b\nGIT binary patch\nliteral 1\n");
    out.longLine = diffLines(`@@ -1 +1 @@\n+${"x".repeat(5000)}\n`).map((l) => l.length);
    out.cut = diffLines("@@ -1 +1 @@\n" + Array.from({ length: 30 }, (_, i) => `+l${i}`).join("\n"), { max: 10 });
    out.exact = diffLines("@@ -1 +1 @@\n" + Array.from({ length: 9 }, (_, i) => `+l${i}`).join("\n"), { max: 10 });
    out.defaultMax = diffLines("@@ -1 +1 @@\n" + Array.from({ length: 1600 }, (_, i) => `+l${i}`).join("\n")).length;
    out.rows = diffRows(["diff --git a/x b/x", "@@ -3,2 +10 @@ ctx", " context", "-removed", "+added\there", "+", "-", "\\ No newline at end of file", "plain",
      "diff --git \"a/q q\" \"b/q q\"", "diff --git a/old b/new", "diff --git a/a b b/a b", "diff --git weird", "diff --git a/x b/x b/x", "+\ttab\tstops", "@@ -1 +1 @@"]);
    out.quotedDifferent = diffRows(['diff --git "a/one" "b/two"']);
    out.width = [diffWidth([]), diffWidth([{ text: "a" }]), diffWidth([{ text: "x".repeat(100) }, { text: "y" }])];
    out.untracked = [untrackedPreview([]), untrackedPreview(Array.from({ length: 25 }, (_, i) => `p${i}`).slice(0, 20)).omitted, untrackedPreview(Array.from({ length: 25 }, (_, i) => `p${i}`))];
    return out;
  },
}, import.meta.url);
