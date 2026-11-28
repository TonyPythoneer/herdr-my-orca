import type { ExecResult } from "herdr";

export type PushGit = (args: string[]) => Promise<ExecResult>;

export type PushRow = {
  remote?: string;
  pushRef?: string;
  tracking?: string;
  upstreamRemote?: string;
  upstreamRef?: string;
  upstream?: string;
};

export type PushTarget = {
  branch: string;
  remote: string;
  ref: string;
  oid: string;
  destination: string;
  leaseTracking: string | null;
};

export type ForcePushTarget = PushTarget & { expected: string };

const BRANCH_PREFIX = "refs/heads/";
const OBJECT_ID = /^[a-f0-9]{40}([a-f0-9]{24})?$/;

const unreadable = (r: ExecResult): boolean => r.code !== 0 && r.code !== 1;

async function readTrimmed(git: PushGit, args: string[], error: string): Promise<string> {
  const r = await git(args);
  if (r.code !== 0) throw new Error(error);
  return r.stdout.trim();
}

async function assertNoCustomRefspecs(git: PushGit, remote: string): Promise<void> {
  const configured = await git(["config", "--get-all", `remote.${remote}.push`]);
  if (configured.code === 0)
    throw new Error("Custom push refspecs are not supported by this panel.");
  if (configured.code !== 1) throw new Error("Cannot verify the configured push refspecs.");
}

async function assertPushPolicy(git: PushGit): Promise<void> {
  const policy = await git(["config", "--get", "push.default"]);
  if (unreadable(policy)) throw new Error("Cannot verify the push policy.");
  if (policy.code === 0 && ["matching", "nothing"].includes(policy.stdout.trim().toLowerCase()))
    throw new Error("The configured push policy does not select one branch.");
}

async function assertNotMirror(git: PushGit, remote: string): Promise<void> {
  const mirror = await git(["config", "--bool", "--get", `remote.${remote}.mirror`]);
  if (unreadable(mirror)) throw new Error("Cannot verify the remote mirror setting.");
  if (mirror.code === 0 && mirror.stdout.trim() !== "false")
    throw new Error("Mirror pushes are not supported by this panel.");
}

async function assertSingleUpstream(git: PushGit, branch: string): Promise<void> {
  const upstreams = await git([
    "config",
    "--get-all",
    `branch.${branch.slice(BRANCH_PREFIX.length)}.merge`,
  ]);
  if (unreadable(upstreams)) throw new Error("Cannot verify the branch upstream.");
  if (
    upstreams.code === 0 &&
    (!upstreams.stdout.trim() || upstreams.stdout.trim().split("\n").length !== 1)
  )
    throw new Error("Branch has multiple upstreams or invalid configuration; push cancelled.");
}

function parsePushRow(rows: string, branch: string): PushRow {
  const matches = rows
    .split("\n")
    .map((line) => line.split("\0"))
    .filter((parts) => parts[0] === branch);
  const [, remote, pushRef, tracking, upstreamRemote, upstreamRef, upstream] =
    matches.length === 1 ? matches[0] : [];
  return { remote, pushRef, tracking, upstreamRemote, upstreamRef, upstream };
}

function pushDestinationRef({
  remote,
  pushRef,
  tracking,
  upstreamRemote,
  upstreamRef,
  upstream,
}: PushRow): string | undefined {
  return (
    pushRef || (remote === upstreamRemote && tracking && tracking === upstream ? upstreamRef : "")
  );
}

function leaseTrackingRef(
  { remote, tracking, upstreamRemote, upstreamRef, upstream }: PushRow,
  ref: string,
): string | null {
  return remote === upstreamRemote &&
    ref === upstreamRef &&
    tracking === upstream &&
    tracking?.startsWith("refs/remotes/")
    ? tracking
    : null;
}

async function readPushUrl(git: PushGit, remote: string): Promise<string> {
  const urls = await readTrimmed(
    git,
    ["remote", "get-url", "--push", "--all", remote],
    "Cannot determine the push remote.",
  );
  if (!urls || urls.split("\n").length !== 1)
    throw new Error(
      "Push remote has multiple destinations or an invalid URL; choose one outside this panel.",
    );
  return urls;
}

export async function resolvePushTarget(git: PushGit): Promise<PushTarget> {
  const branch = await readTrimmed(
    git,
    ["symbolic-ref", "--quiet", "HEAD"],
    "Cannot push a detached HEAD.",
  );
  if (!branch.startsWith(BRANCH_PREFIX)) throw new Error("Cannot determine the current branch.");
  const rows = await readTrimmed(
    git,
    [
      "for-each-ref",
      "--format=%(refname)%00%(push:remotename)%00%(push:remoteref)%00%(push)%00%(upstream:remotename)%00%(upstream:remoteref)%00%(upstream)",
      branch,
    ],
    "Cannot determine the push target.",
  );
  const row = parsePushRow(rows, branch);
  const { remote } = row,
    ref = pushDestinationRef(row);
  if (!remote || remote === "." || remote.startsWith("-") || !ref?.startsWith(BRANCH_PREFIX))
    throw new Error("A single configured push target is required.");
  await assertNoCustomRefspecs(git, remote);
  await assertPushPolicy(git);
  await assertNotMirror(git, remote);
  await assertSingleUpstream(git, branch);
  const destination = await readPushUrl(git, remote);
  const oid = await readTrimmed(
    git,
    ["rev-parse", "--verify", "HEAD^{commit}"],
    "Cannot determine the commit to push.",
  );
  if (!OBJECT_ID.test(oid)) throw new Error("Cannot determine the commit to push.");
  return { branch, remote, ref, oid, destination, leaseTracking: leaseTrackingRef(row, ref) };
}

export const pushArgs = ({
  remote,
  ref,
  oid,
}: Pick<PushTarget, "remote" | "ref" | "oid">): string[] => [
  "push",
  "--no-follow-tags",
  "--recurse-submodules=no",
  "--",
  remote,
  `${oid}:${ref}`,
];

export function displayPushDestination(destination: string): string {
  return destination
    .replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@]*@/i, "$1")
    .replace(/^[^/]*@/, "")
    .replace(/[?#].*$/, "");
}

export function redactPushOutput(value: unknown, destination: string): string {
  return String(value ?? "")
    .split(destination)
    .join(displayPushDestination(destination))
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^/\s]*@/gi, "$1")
    .replace(/([a-z][a-z0-9+.-]*:\/\/[^\s?#]+)[?#][^\s]*/gi, "$1");
}

async function invokePush(git: PushGit, args: string[], target: PushTarget): Promise<ExecResult> {
  try {
    const r = await git(args);
    return {
      ...r,
      stdout: redactPushOutput(r.stdout, target.destination),
      stderr: redactPushOutput(r.stderr, target.destination),
    };
  } catch (e) {
    throw new Error(
      redactPushOutput((e as { message?: unknown }).message || e, target.destination),
    );
  }
}

export async function pushConfigured(git: PushGit, isCurrent: () => boolean): Promise<ExecResult> {
  const first = await resolvePushTarget(git);
  if (!isCurrent()) throw new Error("Workspace or host changed; push cancelled.");
  const latest = await resolvePushTarget(git);
  if (!isCurrent() || JSON.stringify(first) !== JSON.stringify(latest))
    throw new Error("Push target or branch changed; push cancelled.");
  return invokePush(git, pushArgs(first), first);
}

export async function forcePushTarget(git: PushGit): Promise<ForcePushTarget> {
  const target = await resolvePushTarget(git);
  if (!target.leaseTracking)
    throw new Error("A unique remote-tracking branch is required for Force Push.");
  const r = await git(["rev-parse", "--verify", `${target.leaseTracking}^{commit}`]);
  const expected = r.stdout?.trim();
  if (r.code !== 0 || !OBJECT_ID.test(expected))
    throw new Error("Cannot determine the remote-tracking commit for Force Push.");
  return { ...target, expected };
}

export async function forcePushConfirmed(
  git: PushGit,
  target: ForcePushTarget,
  isCurrent: () => boolean,
): Promise<ExecResult> {
  if (!isCurrent()) throw new Error("Workspace or host changed; Force Push cancelled.");
  const latest = await forcePushTarget(git);
  if (!isCurrent() || JSON.stringify(target) !== JSON.stringify(latest))
    throw new Error("Push target, branch or remote-tracking commit changed; Force Push cancelled.");
  const args = pushArgs(target);
  args.splice(1, 0, `--force-with-lease=${target.ref}:${target.expected}`);
  return invokePush(git, args, target);
}
