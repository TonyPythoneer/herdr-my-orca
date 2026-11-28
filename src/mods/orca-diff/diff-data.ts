import { diffLines, untrackedPreview } from "./diff-rows.js";

const READ = [
  "--no-optional-locks",
  "--literal-pathspecs",
  "-c",
  "core.fsmonitor=false",
  "-c",
  "diff.autoRefreshIndex=false",
  "-c",
  "core.quotepath=false",
];
const TAIL = ["--no-ext-diff", "--no-textconv", "--no-color", "--no-renames", "--"];

const BATCH_MAX_PATHS = 200;
const BATCH_MAX_BYTES = 16000;
const BYTES_PER_CHAR = 3;

const MAX_DIFF_LINES = 5000;

const NO_INDEX = "--no-index";
const CACHED = "--cached";
const DEV_NULL = "/dev/null";
const NO_CHANGES = "No changes";
export const UNTRACKED_STATUS = "U";

export const SECTION = { staged: "staged", changes: "changes" } as const;
export type Section = (typeof SECTION)[keyof typeof SECTION];

export type ExecResult = { code: number; stdout: string; stderr: string };
export type ExecOptions = { cwd?: string; on?: string | null };
export type Exec = (command: string, args: string[], options: ExecOptions) => Promise<ExecResult>;
export type DiffTarget = {
  root?: string;
  on?: string | null;
  path?: string;
  status?: string;
  section?: string;
  sectionAll?: boolean;
  all?: boolean;
  limited?: boolean;
  paths?: unknown;
};

type Job = { args: string[]; paths?: string[]; title?: string | null };
type UntrackedJob = Job & { paths: [string, string] };
type SectionTarget = DiffTarget & { section: Section; paths: string[] };
type Plan = { jobs: Job[]; omitted: number; unborn: boolean };

function batches(paths: readonly string[]): string[][] {
  const out: string[][] = [];
  let part: string[] = [],
    size = 0;
  for (const path of paths) {
    const bytes = path.length * BYTES_PER_CHAR + 1;
    if (part.length && (part.length === BATCH_MAX_PATHS || size + bytes > BATCH_MAX_BYTES)) {
      out.push(part);
      part = [];
      size = 0;
    }
    part.push(path);
    size += bytes;
  }
  if (part.length) out.push(part);
  return out;
}

const untrackedJob = (path: string, title?: string | null): UntrackedJob => ({
  args: [NO_INDEX],
  paths: [DEV_NULL, path],
  title,
});

const isSection = (value: string | undefined): value is Section =>
  value === SECTION.staged || value === SECTION.changes;

const isPathList = (value: unknown): value is string[] =>
  Array.isArray(value) &&
  value.every((p: unknown) => typeof p === "string" && p !== "" && !p.includes("\0"));

const isSectionTarget = (target: DiffTarget): target is SectionTarget =>
  isSection(target.section) && isPathList(target.paths);

const isUntrackedJob = (job: Job): job is UntrackedJob => job.args[0] === NO_INDEX;

function classifyStatus(
  stdout: string,
  paths: string[],
  section: Section,
  tracked: string[],
  untracked: string[],
): void {
  const selected = new Set(paths);
  for (const entry of stdout.split("\0").filter(Boolean)) {
    const xy = entry.slice(0, 2),
      path = entry.slice(3);
    if (!selected.has(path)) {
      if (paths.some((p) => path.startsWith(`${p}/`)))
        throw new Error(
          "A selected file became a directory. Refresh Source Control and try again.",
        );
      continue;
    }
    if (xy === "??") {
      if (section === SECTION.changes) untracked.push(path);
      continue;
    }
    if (xy.includes("U") || xy === "AA" || xy === "DD") continue;
    const column = section === SECTION.staged ? xy[0] : xy[1];
    if (column !== " " && column !== "?") tracked.push(path);
  }
}

async function sectionPlan(
  target: DiffTarget,
  git: (args: string[]) => Promise<ExecResult>,
): Promise<Plan> {
  if (!isSectionTarget(target)) throw new Error("Invalid section target");
  const { section, paths: selected } = target;
  const tracked: string[] = [],
    untracked: string[] = [];
  for (const paths of batches([...new Set(selected)])) {
    const status = await git([
      "status",
      "--porcelain=v1",
      "-z",
      "--no-renames",
      "--untracked-files=all",
      "--",
      ...paths,
    ]);
    if (status.code !== 0) throw new Error(status.stderr || "Cannot inspect section changes");
    classifyStatus(status.stdout, paths, section, tracked, untracked);
  }
  const preview = untrackedPreview(untracked);
  const jobs: Job[] = batches(tracked).map((paths) => ({
    args: section === SECTION.staged ? [CACHED] : [],
    paths,
  }));
  jobs.push(...preview.paths.map((path) => untrackedJob(path)));
  return { jobs, omitted: preview.omitted, unborn: false };
}

async function allPlan(git: (args: string[]) => Promise<ExecResult>): Promise<Plan> {
  const un = await git(["ls-files", "--others", "--exclude-standard", "-z"]);
  if (un.code !== 0) throw new Error(un.stderr || "Cannot list untracked files");
  const preview = untrackedPreview(un.stdout.split("\0").filter(Boolean));
  const head = await git(["rev-parse", "--verify", "--quiet", "HEAD"]);
  if (head.code !== 0 && head.code !== 1) throw new Error(head.stderr || "Cannot inspect HEAD");
  const unborn = head.code === 1;
  const jobs: Job[] = unborn
    ? [
        { args: [CACHED], title: "Staged changes" },
        { args: [], title: "Unstaged changes" },
      ]
    : [{ args: ["HEAD"] }];
  jobs.push(...preview.paths.map((path) => untrackedJob(path, unborn ? "Untracked" : null)));
  return { jobs, omitted: preview.omitted, unborn };
}

function singleFilePlan(target: DiffTarget): Plan {
  const fresh = target.status === UNTRACKED_STATUS;
  let args: string[] = [];
  if (target.section === SECTION.staged) args = [CACHED];
  else if (fresh) args = [NO_INDEX];
  return {
    jobs: [{ args, paths: fresh ? [DEV_NULL, target.path!] : [target.path!] }],
    omitted: 0,
    unborn: false,
  };
}

function headerLines(
  target: DiffTarget,
  { omitted, unborn }: Pick<Plan, "omitted" | "unborn">,
): string[] {
  const lines: string[] = [];
  if (target.sectionAll && target.limited)
    lines.push("Only the files shown in Source Control are included");
  if (omitted) lines.push(`… ${omitted} untracked file(s) omitted from preview`);
  if (unborn) lines.push("No initial commit: staged and unstaged changes are shown separately");
  return lines;
}

const isEmptyNewFile = (stdout: string): boolean =>
  /^new file mode /m.test(stdout) &&
  !/^@@/m.test(stdout) &&
  !/^(Binary files|GIT binary patch)/m.test(stdout);

const emptyUntrackedLine = (path: string): string => `Untracked empty file: ${path}`;

function untrackedEmptyLine(job: Job, r: ExecResult): string | null {
  if (!isUntrackedJob(job)) return null;
  const [, path] = job.paths;
  if (!r.stdout.trim()) {
    if (r.code !== 0 && r.stderr?.trim()) throw new Error(r.stderr.trim());
    return emptyUntrackedLine(path);
  }
  return isEmptyNewFile(r.stdout) ? emptyUntrackedLine(path) : null;
}

function assertDiffRead(job: Job, r: ExecResult): void {
  if (r.code !== 0 && !(isUntrackedJob(job) && r.code === 1))
    throw new Error(r.stderr || "Cannot read diff");
}

function jobLines(job: Job, r: ExecResult, many: boolean): { lines: string[]; content: boolean } {
  const emptyFile = untrackedEmptyLine(job, r);
  if (emptyFile) return { lines: [emptyFile], content: false };
  if (!r.stdout.trim()) return { lines: [], content: false };
  const title = job.title ? [job.title] : [];
  return {
    lines: [...title, ...diffLines(r.stdout, many ? { files: true, max: MAX_DIFF_LINES } : {})],
    content: true,
  };
}

export async function loadDiff(target: DiffTarget, exec: Exec): Promise<string[]> {
  const opts = { cwd: target.root, on: target.on };
  const git = (args: string[]): Promise<ExecResult> => exec("git", [...READ, ...args], opts);
  const many = Boolean(target.all || target.sectionAll);

  const plan = !many
    ? singleFilePlan(target)
    : await (target.sectionAll ? sectionPlan(target, git) : allPlan(git));
  const lines = headerLines(target, plan);
  let hasDiff = false;
  for (const job of plan.jobs) {
    const r = await git(["diff", ...job.args, ...TAIL, ...(job.paths ?? [])]);
    assertDiffRead(job, r);
    const added = jobLines(job, r, many);
    if (!added.lines.length) continue;
    hasDiff = true;
    lines.push(...added.lines);
    if (added.content && many && lines.length > MAX_DIFF_LINES)
      return [...lines.slice(0, MAX_DIFF_LINES), `… diff cut at ${MAX_DIFF_LINES} lines`];
  }
  if (!hasDiff) lines.push(NO_CHANGES);
  return lines;
}
