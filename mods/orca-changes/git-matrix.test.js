// Characterization (golden-master) test for push-target.js and create-pr.js: every guard and error message
// is driven through a scripted Git/gh fake and the outcome recorded in git-matrix.golden.json, once from the
// code as it was before the refactor. Delete the golden file to re-record after an intended behavior change.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { displayPushDestination, forcePushConfirmed, forcePushTarget, pushArgs, pushConfigured, redactPushOutput, resolvePushTarget } from "./push-target.js";
import { prepareCreatePr, createPr } from "./create-pr.js";

const GOLDEN = new URL("./git-matrix.golden.json", import.meta.url);
const OID = "a".repeat(40), TRACKED = "b".repeat(40);

const PUSH_BASE = {
  "symbolic-ref --quiet HEAD": { code: 0, stdout: "refs/heads/topic\n" },
  "for-each-ref": { code: 0, stdout: "refs/heads/topic\0origin\0refs/heads/topic\0refs/remotes/origin/topic\0origin\0refs/heads/topic\0refs/remotes/origin/topic" },
  "config --get-all remote.origin.push": { code: 1, stdout: "" },
  "config --get push.default": { code: 1, stdout: "" },
  "config --bool --get remote.origin.mirror": { code: 1, stdout: "" },
  "config --get-all branch.topic.merge": { code: 0, stdout: "refs/heads/topic\n" },
  "remote get-url --push --all origin": { code: 0, stdout: "https://u:p@example.com/r.git\n" },
  "rev-parse --verify HEAD^{commit}": { code: 0, stdout: `${OID}\n` },
  "rev-parse --verify refs/remotes/origin/topic^{commit}": { code: 0, stdout: `${TRACKED}\n` },
  "push --no-follow-tags": { code: 0, stdout: "pushed https://u:p@example.com/r.git\n", stderr: "warn https://x:y@example.com/r.git?token=1" },
};
const row = (...f) => f.join("\0");
const MUTATIONS = {
  base: {},
  detached: { "symbolic-ref --quiet HEAD": { code: 1, stdout: "" } },
  notBranch: { "symbolic-ref --quiet HEAD": { code: 0, stdout: "HEAD\n" } },
  refsFail: { "for-each-ref": { code: 1, stdout: "" } },
  refsTwo: { "for-each-ref": { code: 0, stdout: `${row("refs/heads/topic", "origin", "refs/heads/topic", "t", "origin", "refs/heads/topic", "t")}\n${row("refs/heads/topic", "origin", "refs/heads/topic", "t", "origin", "refs/heads/topic", "t")}` } },
  refsNone: { "for-each-ref": { code: 0, stdout: row("refs/heads/other", "origin", "refs/heads/x", "t", "origin", "refs/heads/x", "t") } },
  refsEmpty: { "for-each-ref": { code: 0, stdout: "" } },
  noPushRefUpstreamSame: { "for-each-ref": { code: 0, stdout: row("refs/heads/topic", "origin", "", "refs/remotes/origin/up", "origin", "refs/heads/up", "refs/remotes/origin/up") } },
  noPushRefUpstreamOther: { "for-each-ref": { code: 0, stdout: row("refs/heads/topic", "origin", "", "refs/remotes/origin/up", "fork", "refs/heads/up", "refs/remotes/origin/up") } },
  noPushRefTrackingDiffers: { "for-each-ref": { code: 0, stdout: row("refs/heads/topic", "origin", "", "refs/remotes/origin/up", "origin", "refs/heads/up", "refs/remotes/origin/other") } },
  remoteDot: { "for-each-ref": { code: 0, stdout: row("refs/heads/topic", ".", "refs/heads/topic", "t", ".", "refs/heads/topic", "t") } },
  remoteDash: { "for-each-ref": { code: 0, stdout: row("refs/heads/topic", "-x", "refs/heads/topic", "t", "-x", "refs/heads/topic", "t") } },
  remoteMissing: { "for-each-ref": { code: 0, stdout: row("refs/heads/topic", "", "refs/heads/topic", "t", "", "refs/heads/topic", "t") } },
  refNotBranch: { "for-each-ref": { code: 0, stdout: row("refs/heads/topic", "origin", "refs/tags/v1", "t", "origin", "refs/tags/v1", "t") } },
  customPush: { "config --get-all remote.origin.push": { code: 0, stdout: "x:y" } },
  customPushUnknown: { "config --get-all remote.origin.push": { code: 2, stdout: "" } },
  policyUnknown: { "config --get push.default": { code: 2, stdout: "" } },
  policyMatching: { "config --get push.default": { code: 0, stdout: "Matching\n" } },
  policyNothing: { "config --get push.default": { code: 0, stdout: "nothing" } },
  policySimple: { "config --get push.default": { code: 0, stdout: "simple" } },
  mirrorUnknown: { "config --bool --get remote.origin.mirror": { code: 2, stdout: "" } },
  mirrorTrue: { "config --bool --get remote.origin.mirror": { code: 0, stdout: "true" } },
  mirrorFalse: { "config --bool --get remote.origin.mirror": { code: 0, stdout: "false\n" } },
  upstreamUnknown: { "config --get-all branch.topic.merge": { code: 2, stdout: "" } },
  upstreamEmpty: { "config --get-all branch.topic.merge": { code: 0, stdout: "\n" } },
  upstreamTwo: { "config --get-all branch.topic.merge": { code: 0, stdout: "a\nb" } },
  upstreamAbsent: { "config --get-all branch.topic.merge": { code: 1, stdout: "" } },
  urlFail: { "remote get-url --push --all origin": { code: 1, stdout: "" } },
  urlEmpty: { "remote get-url --push --all origin": { code: 0, stdout: "\n" } },
  urlTwo: { "remote get-url --push --all origin": { code: 0, stdout: "a\nb" } },
  oidFail: { "rev-parse --verify HEAD^{commit}": { code: 1, stdout: "" } },
  oidBad: { "rev-parse --verify HEAD^{commit}": { code: 0, stdout: "xyz\n" } },
  oid64: { "rev-parse --verify HEAD^{commit}": { code: 0, stdout: `${"c".repeat(64)}\n` } },
  trackingNotRemote: { "for-each-ref": { code: 0, stdout: row("refs/heads/topic", "origin", "refs/heads/topic", "refs/heads/topic", "origin", "refs/heads/topic", "refs/heads/topic") } },
  trackedFail: { "rev-parse --verify refs/remotes/origin/topic^{commit}": { code: 1, stdout: "" } },
  trackedBad: { "rev-parse --verify refs/remotes/origin/topic^{commit}": { code: 0, stdout: "nothex" } },
  pushFails: { "push --no-follow-tags": { code: 1, stdout: "no https://u:p@example.com/r.git", stderr: "denied" } },
  pushThrows: { "push --no-follow-tags": () => { throw new Error("boom https://u:p@example.com/r.git"); } },
  pushThrowsText: { "push --no-follow-tags": () => { throw "text"; } },
};

function pushGit(mutation, calls = []) {
  const script = { ...PUSH_BASE, ...MUTATIONS[mutation] };
  return async (args) => {
    calls.push(args.join(" "));
    const line = args.join(" ");
    for (const [needle, answer] of Object.entries(script)) if (line.includes(needle)) return typeof answer === "function" ? answer() : answer;
    return { code: 0, stdout: "" };
  };
}

async function outcome(fn) {
  try { return { ok: await fn() }; } catch (e) { return { error: e instanceof Error ? e.message : `non-error: ${String(e)}` }; }
}

const GH_URL = "git@github.com:owner/repo.git";
function prState(over = {}) {
  return { branch: "topic", oid: OID, remote: ["origin\0"], merge: ["refs/heads/topic\0"], urls: `${GH_URL}\n`, symbolic: { code: 0, stdout: "refs/heads/topic\n" }, head: { code: 0, stdout: `${OID}\n` },
    repo: { id: "R", nameWithOwner: "owner/repo", isArchived: false, isFork: false, defaultBranchRef: { name: "main", target: { oid: "base" } }, ref: { name: "topic", prefix: "refs/heads/", target: { oid: OID } } },
    gh: undefined, ...over };
}
function prGit(s, calls) {
  return async (args) => {
    calls.push(args.join(" "));
    if (args[0] === "symbolic-ref") return s.symbolic;
    if (args[0] === "rev-parse") return s.head;
    if (args[0] === "config" && args.at(-1).endsWith(".remote")) return { code: s.remoteCode ?? 0, stdout: s.remote[0], stderr: "no remote" };
    if (args[0] === "config") return { code: s.mergeCode ?? 0, stdout: s.merge[0], stderr: "no merge" };
    if (args[0] === "remote") return { code: s.urlCode ?? 0, stdout: s.urls, stderr: "no url" };
    throw new Error(`unexpected git ${args}`);
  };
}
function prGh(s, calls, mutationResult) {
  return async (args) => {
    calls.push(args.filter((a) => !a.startsWith("query=")).join(" "));
    if (s.gh) return typeof s.gh === "function" ? s.gh(args) : s.gh;
    const isMutation = args.some((a) => a.startsWith("query=mutation"));
    if (isMutation) return { code: 0, stdout: JSON.stringify({ data: mutationResult ?? { createPullRequest: { pullRequest: { number: 7, url: "https://github.com/owner/repo/pull/7" } } } }) };
    return { code: 0, stdout: JSON.stringify({ data: { repository: s.repo } }) };
  };
}
const clone = (value) => structuredClone(value);
const repoWith = (patch) => ({ ...clone(prState().repo), ...patch });

const PR_CASES = {
  base: {},
  noSymbolic: { symbolic: { code: 1, stderr: "bad", stdout: "" } },
  notBranch: { symbolic: { code: 0, stdout: "refs/tags/x\n" } },
  headFail: { head: { code: 1, stderr: "", stdout: "" } },
  remoteMissing: { remoteCode: 1 },
  remoteTwo: { remote: ["a\0b\0"] },
  remoteNoNul: { remote: ["origin"] },
  remoteEmpty: { remote: ["\0"] },
  remoteNewline: { remote: ["or\nigin\0"] },
  mergeMissing: { mergeCode: 1 },
  remoteDot: { remote: [".\0"] },
  remoteDash: { remote: ["-x\0"] },
  mergeNotBranch: { merge: ["refs/tags/x\0"] },
  urlFail: { urlCode: 1 },
  urlTwo: { urls: `${GH_URL}\nhttps://github.com/o/r\n` },
  urlHttps: { urls: "https://github.com/owner/repo\n" },
  urlHttpsGit: { urls: "https://github.com/owner/repo.git\n" },
  urlCreds: { urls: "https://t@github.com/owner/repo\n" },
  urlOther: { urls: "git@gitlab.com:owner/repo.git\n" },
  urlDotRepo: { urls: "git@github.com:owner/..\n" },
  urlSingleDot: { urls: "git@github.com:owner/.\n" },
  ghFail: { gh: { code: 1, stderr: "gh broke", stdout: "" } },
  ghFailStdout: { gh: { code: 1, stderr: "", stdout: "out msg" } },
  ghFailNothing: { gh: { code: 1, stderr: "", stdout: "" } },
  ghBadJson: { gh: { code: 0, stdout: "nope" } },
  ghErrors: { gh: { code: 0, stdout: JSON.stringify({ errors: [{ message: "a" }, { message: "b" }] }) } },
  ghNoData: { gh: { code: 0, stdout: JSON.stringify({}) } },
  ghNullRepo: { gh: { code: 0, stdout: JSON.stringify({ data: { repository: null } }) } },
  noId: { repo: repoWith({ id: "" }) },
  archived: { repo: repoWith({ isArchived: true }) },
  fork: { repo: repoWith({ isFork: true }) },
  nameMismatch: { repo: repoWith({ nameWithOwner: "x/y" }) },
  nameCase: { repo: repoWith({ nameWithOwner: "Owner/Repo" }) },
  noBase: { repo: repoWith({ defaultBranchRef: null }) },
  noBaseOid: { repo: repoWith({ defaultBranchRef: { name: "main", target: {} } }) },
  prefix: { repo: repoWith({ ref: { name: "topic", prefix: "refs/tags/", target: { oid: OID } } }) },
  refName: { repo: repoWith({ ref: { name: "other", prefix: "refs/heads/", target: { oid: OID } } }) },
  refOid: { repo: repoWith({ ref: { name: "topic", prefix: "refs/heads/", target: { oid: "zzz" } } }) },
  refNull: { repo: repoWith({ ref: null }) },
  defaultBranch: { repo: repoWith({ defaultBranchRef: { name: "topic", target: { oid: "base" } } }) },
};

test("push and PR helpers behave as recorded across every guard", async () => {
  const out = { push: {}, force: {}, pushConfigured: {}, pushForceConfirmed: {}, redaction: {}, pr: {}, createPr: {} };
  for (const name of Object.keys(MUTATIONS)) {
    const calls = [];
    out.push[name] = { ...await outcome(() => resolvePushTarget(pushGit(name, calls))), calls };
    out.force[name] = await outcome(() => forcePushTarget(pushGit(name)));
    for (const [label, flips] of Object.entries({ always: [true, true, true], secondFalse: [true, false], firstFalse: [false] })) {
      let i = 0;
      const key = `${name}/${label}`;
      out.pushConfigured[key] = await outcome(() => pushConfigured(pushGit(name), () => flips[i++] ?? true));
    }
    let n = 0;
    const changing = async (args) => { const r = await pushGit(name)(args); return args[0] === "rev-parse" && args[2] === "HEAD^{commit}" && ++n > 1 ? { code: 0, stdout: `${"d".repeat(40)}\n` } : r; };
    out.pushConfigured[`${name}/targetChanges`] = await outcome(() => pushConfigured(changing, () => true));
    const target = await outcome(() => forcePushTarget(pushGit(name)));
    if (target.ok) {
      for (const [label, flips] of Object.entries({ always: [], firstFalse: [false], secondFalse: [true, false] })) {
        let i = 0;
        out.pushForceConfirmed[`${name}/${label}`] = await outcome(() => forcePushConfirmed(pushGit(name), target.ok, () => flips[i++] ?? true));
      }
      out.pushForceConfirmed[`${name}/staleTarget`] = await outcome(() => forcePushConfirmed(pushGit(name), { ...target.ok, expected: "c".repeat(40) }, () => true));
    }
  }
  for (const value of ["https://user:secret@example.invalid/repo?token=1#f", "user:pw@host:repo", "/tmp/a@b", "ssh://git@host/x", "plain"]) out.redaction[value] = displayPushDestination(value);
  out.redaction.redact = [["x https://a:b@h/p?q=1 y", "https://a:b@h/p?q=1"], [undefined, "d"], [null, ""], [42, "42"]].map(([v, d]) => redactPushOutput(v, d));
  out.redaction.args = pushArgs({ remote: "origin", ref: "refs/heads/t", oid: OID });

  for (const [name, patch] of Object.entries(PR_CASES)) {
    const s = prState(patch), calls = [];
    out.pr[name] = { ...await outcome(() => prepareCreatePr(prGit(s, calls), prGh(s, calls))), calls };
  }
  const base = prState(), snapshot = (await outcome(() => prepareCreatePr(prGit(base, []), prGh(base, [])))).ok;
  const run = (s, current, title, body, draft, mutation) => { const calls = []; return outcome(async () => ({ pr: await createPr({ snapshot, git: prGit(s, calls), gh: prGh(s, calls, mutation), current, title, body, draft }), calls })); };
  out.createPr.ok = await run(prState(), () => true, "T", "B", true);
  out.createPr.notDraft = await run(prState(), () => true, "T", "B", 0);
  out.createPr.notCurrent = await run(prState(), () => false, "T", "B", true);
  out.createPr.becomesStale = await run(prState(), (() => { let i = 0; return () => i++ < 1; })(), "T", "B", true);
  out.createPr.changedRepo = await run(prState({ repo: repoWith({ defaultBranchRef: { name: "dev", target: { oid: "base" } } }) }), () => true, "T", "B", true);
  out.createPr.noTitle = await run(prState(), () => true, "  ", "B", true);
  out.createPr.mutationErrors = await run(prState(), () => true, "T", "B", true, { errors: [{ message: "denied" }] });
  out.createPr.noPr = await run(prState(), () => true, "T", "B", true, { createPullRequest: {} });
  out.createPr.badUrl = await run(prState(), () => true, "T", "B", true, { createPullRequest: { pullRequest: { number: 3, url: "http://evil/x" } } });
  out.createPr.noUrl = await run(prState(), () => true, "T", "B", true, { createPullRequest: { pullRequest: { number: 3 } } });
  out.createPr.noNumber = await run(prState(), () => true, "T", "B", true, { createPullRequest: { pullRequest: { url: "https://github.com/a/b/pull/1" } } });
  out.createPr.badJson = await run(prState({ gh: (args) => args.some((a) => a.startsWith("query=mutation")) ? { code: 0, stdout: "{" } : { code: 0, stdout: JSON.stringify({ data: { repository: prState().repo } }) } }), () => true, "T", "B", true);
  out.createPr.mutationCodeFail = await run(prState({ gh: (args) => args.some((a) => a.startsWith("query=mutation")) ? { code: 1, stderr: "http 500", stdout: "" } : { code: 0, stdout: JSON.stringify({ data: { repository: prState().repo } }) } }), () => true, "T", "B", true);

  const recorded = JSON.parse(JSON.stringify(out));
  if (!existsSync(GOLDEN)) writeFileSync(GOLDEN, JSON.stringify(recorded, null, 1) + "\n");
  assert.deepStrictEqual(recorded, JSON.parse(readFileSync(GOLDEN, "utf8")));
});
