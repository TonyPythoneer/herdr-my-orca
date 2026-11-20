// Resolve one configured push destination; never let push.default expand the refspec.
export async function resolvePushTarget(git) {
  const read = async (args, error) => {
    const r = await git(args);
    if (r.code !== 0) throw new Error(error);
    return r.stdout.trim();
  };
  const branch = await read(["symbolic-ref", "--quiet", "HEAD"], "Cannot push a detached HEAD.");
  if (!branch.startsWith("refs/heads/")) throw new Error("Cannot determine the current branch.");
  const rows = await read(["for-each-ref", "--format=%(refname)%00%(push:remotename)%00%(push:remoteref)%00%(push)%00%(upstream:remotename)%00%(upstream:remoteref)%00%(upstream)", branch], "Cannot determine the push target.");
  const matches = rows.split("\n").map((line) => line.split("\0")).filter((parts) => parts[0] === branch);
  const [_, remote, pushRef, tracking, upstreamRemote, upstreamRef, upstream] = matches.length === 1 ? matches[0] : [];
  const ref = pushRef || (remote === upstreamRemote && tracking && tracking === upstream ? upstreamRef : "");
  if (!remote || remote === "." || remote.startsWith("-") || !ref?.startsWith("refs/heads/")) throw new Error("A single configured push target is required.");
  const configured = await git(["config", "--get-all", `remote.${remote}.push`]);
  if (configured.code === 0) throw new Error("Custom push refspecs are not supported by this panel.");
  if (configured.code !== 1) throw new Error("Cannot verify the configured push refspecs.");
  const policy = await git(["config", "--get", "push.default"]);
  if (policy.code !== 0 && policy.code !== 1) throw new Error("Cannot verify the push policy.");
  if (policy.code === 0 && ["matching", "nothing"].includes(policy.stdout.trim().toLowerCase())) throw new Error("The configured push policy does not select one branch.");
  const mirror = await git(["config", "--bool", "--get", `remote.${remote}.mirror`]);
  if (mirror.code !== 0 && mirror.code !== 1) throw new Error("Cannot verify the remote mirror setting.");
  if (mirror.code === 0 && mirror.stdout.trim() !== "false") throw new Error("Mirror pushes are not supported by this panel.");
  const upstreams = await git(["config", "--get-all", `branch.${branch.slice("refs/heads/".length)}.merge`]);
  if (upstreams.code !== 0 && upstreams.code !== 1) throw new Error("Cannot verify the branch upstream.");
  if (upstreams.code === 0 && (!upstreams.stdout.trim() || upstreams.stdout.trim().split("\n").length !== 1)) throw new Error("Branch has multiple upstreams or invalid configuration; push cancelled.");
  const urls = await read(["remote", "get-url", "--push", "--all", remote], "Cannot determine the push remote.");
  if (!urls || urls.split("\n").length !== 1) throw new Error("Push remote has multiple destinations or an invalid URL; choose one outside this panel.");
  const oid = await read(["rev-parse", "--verify", "HEAD^{commit}"], "Cannot determine the commit to push.");
  if (!/^[a-f0-9]{40}([a-f0-9]{24})?$/.test(oid)) throw new Error("Cannot determine the commit to push.");
  const leaseTracking = remote === upstreamRemote && ref === upstreamRef && tracking === upstream && tracking?.startsWith("refs/remotes/") ? tracking : null;
  return { branch, remote, ref, oid, destination: urls, leaseTracking };
}

export const pushArgs = ({ remote, ref, oid }) => ["push", "--no-follow-tags", "--recurse-submodules=no", "--", remote, `${oid}:${ref}`];

export function displayPushDestination(destination) {
  return destination.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@]*@/i, "$1").replace(/^[^/]*@/, "").replace(/[?#].*$/, "");
}

export function redactPushOutput(value, destination) {
  return String(value ?? "").split(destination).join(displayPushDestination(destination))
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^/\s]*@/gi, "$1")
    .replace(/([a-z][a-z0-9+.-]*:\/\/[^\s?#]+)[?#][^\s]*/gi, "$1");
}

async function invokePush(git, args, target) {
  try {
    const r = await git(args);
    return { ...r, stdout: redactPushOutput(r.stdout, target.destination), stderr: redactPushOutput(r.stderr, target.destination) };
  } catch (e) { throw new Error(redactPushOutput(e.message || e, target.destination)); }
}

export async function pushConfigured(git, isCurrent) {
  const first = await resolvePushTarget(git);
  if (!isCurrent()) throw new Error("Workspace or host changed; push cancelled.");
  const latest = await resolvePushTarget(git);
  if (!isCurrent() || JSON.stringify(first) !== JSON.stringify(latest)) throw new Error("Push target or branch changed; push cancelled.");
  return invokePush(git, pushArgs(first), first);
}

export async function forcePushTarget(git) {
  const target = await resolvePushTarget(git);
  if (!target.leaseTracking) throw new Error("A unique remote-tracking branch is required for Force Push.");
  const r = await git(["rev-parse", "--verify", `${target.leaseTracking}^{commit}`]);
  const expected = r.stdout?.trim();
  if (r.code !== 0 || !/^[a-f0-9]{40}([a-f0-9]{24})?$/.test(expected)) throw new Error("Cannot determine the remote-tracking commit for Force Push.");
  return { ...target, expected };
}

export async function forcePushConfirmed(git, target, isCurrent) {
  if (!isCurrent()) throw new Error("Workspace or host changed; Force Push cancelled.");
  const latest = await forcePushTarget(git);
  if (!isCurrent() || JSON.stringify(target) !== JSON.stringify(latest)) throw new Error("Push target, branch or remote-tracking commit changed; Force Push cancelled.");
  const args = pushArgs(target);
  args.splice(1, 0, `--force-with-lease=${target.ref}:${target.expected}`);
  return invokePush(git, args, target);
}
