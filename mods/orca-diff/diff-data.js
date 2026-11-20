import { diffLines, untrackedPreview } from "./diff-rows.js";

const READ = ["--no-optional-locks", "--literal-pathspecs", "-c", "core.fsmonitor=false", "-c", "diff.autoRefreshIndex=false", "-c", "core.quotepath=false"];
const TAIL = ["--no-ext-diff", "--no-textconv", "--no-color", "--no-renames", "--"];

function batches(paths) {
  const out = []; let part = [], size = 0;
  for (const path of paths) {
    const bytes = path.length * 3 + 1;
    if (part.length && (part.length === 200 || size + bytes > 16000)) { out.push(part); part = []; size = 0; }
    part.push(path); size += bytes;
  }
  if (part.length) out.push(part);
  return out;
}

export async function loadDiff(target, exec) {
  const opts = { cwd: target.root, on: target.on };
  const git = (args) => exec("git", [...READ, ...args], opts);
  let jobs, omitted = 0, unborn = false;
  if (target.sectionAll) {
    if (!["staged", "changes"].includes(target.section) || !Array.isArray(target.paths) || target.paths.some((p) => typeof p !== "string" || !p || p.includes("\0"))) throw new Error("Invalid section target");
    const tracked = [], untracked = [];
    for (const paths of batches([...new Set(target.paths)])) {
      const selected = new Set(paths);
      const status = await git(["status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all", "--", ...paths]);
      if (status.code !== 0) throw new Error(status.stderr || "Cannot inspect section changes");
      for (const entry of status.stdout.split("\0").filter(Boolean)) {
        const xy = entry.slice(0, 2), path = entry.slice(3);
        if (!selected.has(path)) {
          if (paths.some((p) => path.startsWith(`${p}/`))) throw new Error("A selected file became a directory. Refresh Source Control and try again.");
          continue;
        }
        if (xy === "??") { if (target.section === "changes") untracked.push(path); continue; }
        if (xy.includes("U") || xy === "AA" || xy === "DD") continue;
        if (target.section === "staged" ? xy[0] !== " " && xy[0] !== "?" : xy[1] !== " " && xy[1] !== "?") tracked.push(path);
      }
    }
    const preview = untrackedPreview(untracked); omitted = preview.omitted;
    jobs = batches(tracked).map((paths) => ({ args: target.section === "staged" ? ["--cached"] : [], paths }));
    jobs.push(...preview.paths.map((path) => ({ args: ["--no-index"], paths: ["/dev/null", path] })));
  } else if (target.all) {
    const un = await git(["ls-files", "--others", "--exclude-standard", "-z"]);
    if (un.code !== 0) throw new Error(un.stderr || "Cannot list untracked files");
    const preview = untrackedPreview(un.stdout.split("\0").filter(Boolean));
    omitted = preview.omitted;
    const head = await git(["rev-parse", "--verify", "--quiet", "HEAD"]);
    if (head.code !== 0 && head.code !== 1) throw new Error(head.stderr || "Cannot inspect HEAD");
    unborn = head.code === 1;
    jobs = unborn ? [{ args: ["--cached"], title: "Staged changes" }, { args: [], title: "Unstaged changes" }] : [{ args: ["HEAD"] }];
    jobs.push(...preview.paths.map((path) => ({ args: ["--no-index"], paths: ["/dev/null", path], title: unborn ? "Untracked" : null })));
  } else {
    const fresh = target.status === "U";
    jobs = [{ args: target.section === "staged" ? ["--cached"] : fresh ? ["--no-index"] : [], paths: fresh ? ["/dev/null", target.path] : [target.path] }];
  }

  const lines = []; let hasDiff = false;
  if (target.sectionAll && target.limited) lines.push("Only the files shown in Source Control are included");
  if (omitted) lines.push(`… ${omitted} untracked file(s) omitted from preview`);
  if (unborn) lines.push("No initial commit: staged and unstaged changes are shown separately");
  for (const job of jobs) {
    const r = await git(["diff", ...job.args, ...TAIL, ...(job.paths ?? [])]);
    if (r.code !== 0 && !(job.args[0] === "--no-index" && r.code === 1)) throw new Error(r.stderr || "Cannot read diff");
    if (!r.stdout.trim()) {
      if (job.args[0] === "--no-index") {
        if (r.code !== 0 && r.stderr?.trim()) throw new Error(r.stderr.trim());
        lines.push(`Untracked empty file: ${job.paths[1]}`); hasDiff = true;
      }
      continue;
    }
    if (job.args[0] === "--no-index" && /^new file mode /m.test(r.stdout) && !/^@@/m.test(r.stdout) && !/^(Binary files|GIT binary patch)/m.test(r.stdout)) {
      lines.push(`Untracked empty file: ${job.paths[1]}`); hasDiff = true; continue;
    }
    hasDiff = true;
    if (job.title) lines.push(job.title);
    lines.push(...diffLines(r.stdout, target.all || target.sectionAll ? { files: true, max: 5000 } : {}));
    if ((target.all || target.sectionAll) && lines.length > 5000) return [...lines.slice(0, 5000), "… diff cut at 5000 lines"];
  }
  if (!hasDiff) lines.push("No changes");
  return lines;
}
