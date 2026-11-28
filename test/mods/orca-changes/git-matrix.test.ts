import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { ExecResult } from "herdr";
import {
  displayPushDestination,
  forcePushConfirmed,
  forcePushTarget,
  pushArgs,
  pushConfigured,
  redactPushOutput,
  resolvePushTarget,
  type ForcePushTarget,
  type PushGit,
} from "../../../src/mods/orca-changes/push-target.js";
import {
  prepareCreatePr,
  createPr,
  type PrSnapshot,
} from "../../../src/mods/orca-changes/create-pr.js";

type Answer = ExecResult | (() => ExecResult);
type Answers = Record<string, Answer>;
type Repo = Record<string, unknown>;
type PrState = {
  branch: string;
  oid: string;
  remote: string[];
  merge: string[];
  urls: string;
  symbolic: ExecResult;
  head: ExecResult;
  repo: Repo;
  gh?: Answer | ((args: string[]) => ExecResult);
  remoteCode?: number;
  urlCode?: number;
  mergeCode?: number;
};
type Outcome<T> = { ok?: T; error?: string };

const GOLDEN = new URL("./git-matrix.golden.json", import.meta.url);
const OID = "a".repeat(40),
  TRACKED = "b".repeat(40);

const PUSH_BASE: Answers = {
  "symbolic-ref --quiet HEAD": { code: 0, stdout: "refs/heads/topic\n", stderr: "" },
  "for-each-ref": {
    code: 0,
    stdout:
      "refs/heads/topic\0origin\0refs/heads/topic\0refs/remotes/origin/topic\0origin\0refs/heads/topic\0refs/remotes/origin/topic",
    stderr: "",
  },
  "config --get-all remote.origin.push": { code: 1, stdout: "", stderr: "" },
  "config --get push.default": { code: 1, stdout: "", stderr: "" },
  "config --bool --get remote.origin.mirror": { code: 1, stdout: "", stderr: "" },
  "config --get-all branch.topic.merge": { code: 0, stdout: "refs/heads/topic\n", stderr: "" },
  "remote get-url --push --all origin": {
    code: 0,
    stdout: "https://u:p@example.com/r.git\n",
    stderr: "",
  },
  "rev-parse --verify HEAD^{commit}": { code: 0, stdout: `${OID}\n`, stderr: "" },
  "rev-parse --verify refs/remotes/origin/topic^{commit}": {
    code: 0,
    stdout: `${TRACKED}\n`,
    stderr: "",
  },
  "push --no-follow-tags": {
    code: 0,
    stdout: "pushed https://u:p@example.com/r.git\n",
    stderr: "warn https://x:y@example.com/r.git?token=1",
  },
};
const row = (...f: string[]): string => f.join("\0");
const MUTATIONS: Record<string, Answers> = {
  base: {},
  detached: { "symbolic-ref --quiet HEAD": { code: 1, stdout: "", stderr: "" } },
  notBranch: { "symbolic-ref --quiet HEAD": { code: 0, stdout: "HEAD\n", stderr: "" } },
  refsFail: { "for-each-ref": { code: 1, stdout: "", stderr: "" } },
  refsTwo: {
    "for-each-ref": {
      code: 0,
      stdout: `${row("refs/heads/topic", "origin", "refs/heads/topic", "t", "origin", "refs/heads/topic", "t")}\n${row("refs/heads/topic", "origin", "refs/heads/topic", "t", "origin", "refs/heads/topic", "t")}`,
      stderr: "",
    },
  },
  refsNone: {
    "for-each-ref": {
      code: 0,
      stdout: row("refs/heads/other", "origin", "refs/heads/x", "t", "origin", "refs/heads/x", "t"),
      stderr: "",
    },
  },
  refsEmpty: { "for-each-ref": { code: 0, stdout: "", stderr: "" } },
  noPushRefUpstreamSame: {
    "for-each-ref": {
      code: 0,
      stdout: row(
        "refs/heads/topic",
        "origin",
        "",
        "refs/remotes/origin/up",
        "origin",
        "refs/heads/up",
        "refs/remotes/origin/up",
      ),
      stderr: "",
    },
  },
  noPushRefUpstreamOther: {
    "for-each-ref": {
      code: 0,
      stdout: row(
        "refs/heads/topic",
        "origin",
        "",
        "refs/remotes/origin/up",
        "fork",
        "refs/heads/up",
        "refs/remotes/origin/up",
      ),
      stderr: "",
    },
  },
  noPushRefTrackingDiffers: {
    "for-each-ref": {
      code: 0,
      stdout: row(
        "refs/heads/topic",
        "origin",
        "",
        "refs/remotes/origin/up",
        "origin",
        "refs/heads/up",
        "refs/remotes/origin/other",
      ),
      stderr: "",
    },
  },
  remoteDot: {
    "for-each-ref": {
      code: 0,
      stdout: row("refs/heads/topic", ".", "refs/heads/topic", "t", ".", "refs/heads/topic", "t"),
      stderr: "",
    },
  },
  remoteDash: {
    "for-each-ref": {
      code: 0,
      stdout: row("refs/heads/topic", "-x", "refs/heads/topic", "t", "-x", "refs/heads/topic", "t"),
      stderr: "",
    },
  },
  remoteMissing: {
    "for-each-ref": {
      code: 0,
      stdout: row("refs/heads/topic", "", "refs/heads/topic", "t", "", "refs/heads/topic", "t"),
      stderr: "",
    },
  },
  refNotBranch: {
    "for-each-ref": {
      code: 0,
      stdout: row("refs/heads/topic", "origin", "refs/tags/v1", "t", "origin", "refs/tags/v1", "t"),
      stderr: "",
    },
  },
  customPush: { "config --get-all remote.origin.push": { code: 0, stdout: "x:y", stderr: "" } },
  customPushUnknown: { "config --get-all remote.origin.push": { code: 2, stdout: "", stderr: "" } },
  policyUnknown: { "config --get push.default": { code: 2, stdout: "", stderr: "" } },
  policyMatching: { "config --get push.default": { code: 0, stdout: "Matching\n", stderr: "" } },
  policyNothing: { "config --get push.default": { code: 0, stdout: "nothing", stderr: "" } },
  policySimple: { "config --get push.default": { code: 0, stdout: "simple", stderr: "" } },
  mirrorUnknown: {
    "config --bool --get remote.origin.mirror": { code: 2, stdout: "", stderr: "" },
  },
  mirrorTrue: {
    "config --bool --get remote.origin.mirror": { code: 0, stdout: "true", stderr: "" },
  },
  mirrorFalse: {
    "config --bool --get remote.origin.mirror": { code: 0, stdout: "false\n", stderr: "" },
  },
  upstreamUnknown: { "config --get-all branch.topic.merge": { code: 2, stdout: "", stderr: "" } },
  upstreamEmpty: { "config --get-all branch.topic.merge": { code: 0, stdout: "\n", stderr: "" } },
  upstreamTwo: { "config --get-all branch.topic.merge": { code: 0, stdout: "a\nb", stderr: "" } },
  upstreamAbsent: { "config --get-all branch.topic.merge": { code: 1, stdout: "", stderr: "" } },
  urlFail: { "remote get-url --push --all origin": { code: 1, stdout: "", stderr: "" } },
  urlEmpty: { "remote get-url --push --all origin": { code: 0, stdout: "\n", stderr: "" } },
  urlTwo: { "remote get-url --push --all origin": { code: 0, stdout: "a\nb", stderr: "" } },
  oidFail: { "rev-parse --verify HEAD^{commit}": { code: 1, stdout: "", stderr: "" } },
  oidBad: { "rev-parse --verify HEAD^{commit}": { code: 0, stdout: "xyz\n", stderr: "" } },
  oid64: {
    "rev-parse --verify HEAD^{commit}": { code: 0, stdout: `${"c".repeat(64)}\n`, stderr: "" },
  },
  trackingNotRemote: {
    "for-each-ref": {
      code: 0,
      stdout: row(
        "refs/heads/topic",
        "origin",
        "refs/heads/topic",
        "refs/heads/topic",
        "origin",
        "refs/heads/topic",
        "refs/heads/topic",
      ),
      stderr: "",
    },
  },
  trackedFail: {
    "rev-parse --verify refs/remotes/origin/topic^{commit}": { code: 1, stdout: "", stderr: "" },
  },
  trackedBad: {
    "rev-parse --verify refs/remotes/origin/topic^{commit}": {
      code: 0,
      stdout: "nothex",
      stderr: "",
    },
  },
  pushFails: {
    "push --no-follow-tags": {
      code: 1,
      stdout: "no https://u:p@example.com/r.git",
      stderr: "denied",
    },
  },
  pushThrows: {
    "push --no-follow-tags": () => {
      throw new Error("boom https://u:p@example.com/r.git");
    },
  },
  pushThrowsText: {
    "push --no-follow-tags": () => {
      throw "text";
    },
  },
};

function pushGit(mutation: string, calls: string[] = []): PushGit {
  const script: Answers = { ...PUSH_BASE, ...MUTATIONS[mutation] };
  return async (args: string[]) => {
    calls.push(args.join(" "));
    const line = args.join(" ");
    for (const [needle, answer] of Object.entries(script))
      if (line.includes(needle)) return typeof answer === "function" ? answer() : answer;
    return { code: 0, stdout: "", stderr: "" };
  };
}

async function outcome<T>(fn: () => Promise<T>): Promise<Outcome<T>> {
  try {
    return { ok: await fn() };
  } catch (e) {
    return { error: e instanceof Error ? e.message : `non-error: ${String(e)}` };
  }
}

const GH_URL = "git@github.com:owner/repo.git";
function prState(over: Partial<PrState> = {}): PrState {
  return {
    branch: "topic",
    oid: OID,
    remote: ["origin\0"],
    merge: ["refs/heads/topic\0"],
    urls: `${GH_URL}\n`,
    symbolic: { code: 0, stdout: "refs/heads/topic\n", stderr: "" },
    head: { code: 0, stdout: `${OID}\n`, stderr: "" },
    repo: {
      id: "R",
      nameWithOwner: "owner/repo",
      isArchived: false,
      isFork: false,
      defaultBranchRef: { name: "main", target: { oid: "base" } },
      ref: { name: "topic", prefix: "refs/heads/", target: { oid: OID } },
    },
    gh: undefined,
    ...over,
  };
}
function prGit(s: PrState, calls: string[]): PrGitFn {
  return async (args: string[]) => {
    calls.push(args.join(" "));
    if (args[0] === "symbolic-ref") return s.symbolic;
    if (args[0] === "rev-parse") return s.head;
    if (args[0] === "config" && (args.at(-1) as string).endsWith(".remote"))
      return { code: s.remoteCode ?? 0, stdout: s.remote[0], stderr: "no remote" };
    if (args[0] === "config")
      return { code: s.mergeCode ?? 0, stdout: s.merge[0], stderr: "no merge" };
    if (args[0] === "remote") return { code: s.urlCode ?? 0, stdout: s.urls, stderr: "no url" };
    throw new Error(`unexpected git ${String(args)}`);
  };
}
type PrGitFn = (args: string[]) => Promise<ExecResult>;
function prGh(s: PrState, calls: string[], mutationResult?: unknown): PrGitFn {
  return async (args: string[]) => {
    calls.push(args.filter((a) => !a.startsWith("query=")).join(" "));
    if (s.gh) return typeof s.gh === "function" ? s.gh(args) : (s.gh as ExecResult);
    const isMutation = args.some((a) => a.startsWith("query=mutation"));
    if (isMutation)
      return {
        code: 0,
        stdout: JSON.stringify({
          data: mutationResult ?? {
            createPullRequest: {
              pullRequest: { number: 7, url: "https://github.com/owner/repo/pull/7" },
            },
          },
        }),
        stderr: "",
      };
    return { code: 0, stdout: JSON.stringify({ data: { repository: s.repo } }), stderr: "" };
  };
}
const clone = <T>(value: T): T => structuredClone(value);
const repoWith = (patch: Repo): Repo => ({ ...clone(prState().repo), ...patch });

const PR_CASES: Record<string, Partial<PrState>> = {
  base: {},
  noSymbolic: { symbolic: { code: 1, stderr: "bad", stdout: "" } },
  notBranch: { symbolic: { code: 0, stdout: "refs/tags/x\n", stderr: "" } },
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
  ghBadJson: { gh: { code: 0, stdout: "nope", stderr: "" } },
  ghErrors: {
    gh: {
      code: 0,
      stdout: JSON.stringify({ errors: [{ message: "a" }, { message: "b" }] }),
      stderr: "",
    },
  },
  ghNoData: { gh: { code: 0, stdout: JSON.stringify({}), stderr: "" } },
  ghNullRepo: {
    gh: { code: 0, stdout: JSON.stringify({ data: { repository: null } }), stderr: "" },
  },
  noId: { repo: repoWith({ id: "" }) },
  archived: { repo: repoWith({ isArchived: true }) },
  fork: { repo: repoWith({ isFork: true }) },
  nameMismatch: { repo: repoWith({ nameWithOwner: "x/y" }) },
  nameCase: { repo: repoWith({ nameWithOwner: "Owner/Repo" }) },
  noBase: { repo: repoWith({ defaultBranchRef: null }) },
  noBaseOid: { repo: repoWith({ defaultBranchRef: { name: "main", target: {} } }) },
  prefix: {
    repo: repoWith({ ref: { name: "topic", prefix: "refs/tags/", target: { oid: OID } } }),
  },
  refName: {
    repo: repoWith({ ref: { name: "other", prefix: "refs/heads/", target: { oid: OID } } }),
  },
  refOid: {
    repo: repoWith({ ref: { name: "topic", prefix: "refs/heads/", target: { oid: "zzz" } } }),
  },
  refNull: { repo: repoWith({ ref: null }) },
  defaultBranch: {
    repo: repoWith({ defaultBranchRef: { name: "topic", target: { oid: "base" } } }),
  },
};

test("push and PR helpers behave as recorded across every guard", async () => {
  const out: Record<string, Record<string, unknown>> = {
    push: {},
    force: {},
    pushConfigured: {},
    pushForceConfirmed: {},
    redaction: {},
    pr: {},
    createPr: {},
  };
  for (const name of Object.keys(MUTATIONS)) {
    const calls: string[] = [];
    out.push[name] = { ...(await outcome(() => resolvePushTarget(pushGit(name, calls)))), calls };
    out.force[name] = await outcome(() => forcePushTarget(pushGit(name)));
    for (const [label, flips] of Object.entries({
      always: [true, true, true],
      secondFalse: [true, false],
      firstFalse: [false],
    })) {
      let i = 0;
      const key = `${name}/${label}`;
      out.pushConfigured[key] = await outcome(() =>
        pushConfigured(pushGit(name), () => flips[i++] ?? true),
      );
    }
    let n = 0;
    const changing: PushGit = async (args) => {
      const r = await pushGit(name)(args);
      return args[0] === "rev-parse" && args[2] === "HEAD^{commit}" && ++n > 1
        ? { code: 0, stdout: `${"d".repeat(40)}\n`, stderr: "" }
        : r;
    };
    out.pushConfigured[`${name}/targetChanges`] = await outcome(() =>
      pushConfigured(changing, () => true),
    );
    const target = await outcome(() => forcePushTarget(pushGit(name)));
    if (target.ok) {
      const confirmed: ForcePushTarget = target.ok;
      for (const [label, flips] of Object.entries({
        always: [] as boolean[],
        firstFalse: [false],
        secondFalse: [true, false],
      })) {
        let i = 0;
        out.pushForceConfirmed[`${name}/${label}`] = await outcome(() =>
          forcePushConfirmed(pushGit(name), confirmed, () => flips[i++] ?? true),
        );
      }
      out.pushForceConfirmed[`${name}/staleTarget`] = await outcome(() =>
        forcePushConfirmed(pushGit(name), { ...confirmed, expected: "c".repeat(40) }, () => true),
      );
    }
  }
  for (const value of [
    "https://user:secret@example.invalid/repo?token=1#f",
    "user:pw@host:repo",
    "/tmp/a@b",
    "ssh://git@host/x",
    "plain",
  ])
    out.redaction[value] = displayPushDestination(value);
  const redactCases: [unknown, string][] = [
    ["x https://a:b@h/p?q=1 y", "https://a:b@h/p?q=1"],
    [undefined, "d"],
    [null, ""],
    [42, "42"],
  ];
  out.redaction.redact = redactCases.map(([v, d]) => redactPushOutput(v, d));
  out.redaction.args = pushArgs({ remote: "origin", ref: "refs/heads/t", oid: OID });

  for (const [name, patch] of Object.entries(PR_CASES)) {
    const s = prState(patch),
      calls: string[] = [];
    out.pr[name] = {
      ...(await outcome(() => prepareCreatePr(prGit(s, calls), prGh(s, calls)))),
      calls,
    };
  }
  const base = prState();
  const snapshot: PrSnapshot = await prepareCreatePr(prGit(base, []), prGh(base, []));
  const run = (
    s: PrState,
    current: () => boolean,
    title: string,
    body: string,
    draft: boolean,
    mutation?: unknown,
  ) => {
    const calls: string[] = [];
    return outcome(async () => ({
      pr: await createPr({
        snapshot,
        git: prGit(s, calls),
        gh: prGh(s, calls, mutation),
        current,
        title,
        body,
        draft,
      }),
      calls,
    }));
  };
  out.createPr.ok = await run(prState(), () => true, "T", "B", true);
  out.createPr.notDraft = await run(prState(), () => true, "T", "B", false);
  out.createPr.notCurrent = await run(prState(), () => false, "T", "B", true);
  out.createPr.becomesStale = await run(
    prState(),
    (() => {
      let i = 0;
      return () => i++ < 1;
    })(),
    "T",
    "B",
    true,
  );
  out.createPr.changedRepo = await run(
    prState({ repo: repoWith({ defaultBranchRef: { name: "dev", target: { oid: "base" } } }) }),
    () => true,
    "T",
    "B",
    true,
  );
  out.createPr.noTitle = await run(prState(), () => true, "  ", "B", true);
  out.createPr.mutationErrors = await run(prState(), () => true, "T", "B", true, {
    errors: [{ message: "denied" }],
  });
  out.createPr.noPr = await run(prState(), () => true, "T", "B", true, { createPullRequest: {} });
  out.createPr.badUrl = await run(prState(), () => true, "T", "B", true, {
    createPullRequest: { pullRequest: { number: 3, url: "http://evil/x" } },
  });
  out.createPr.noUrl = await run(prState(), () => true, "T", "B", true, {
    createPullRequest: { pullRequest: { number: 3 } },
  });
  out.createPr.noNumber = await run(prState(), () => true, "T", "B", true, {
    createPullRequest: { pullRequest: { url: "https://github.com/a/b/pull/1" } },
  });
  out.createPr.badJson = await run(
    prState({
      gh: (args) =>
        args.some((a) => a.startsWith("query=mutation"))
          ? { code: 0, stdout: "{", stderr: "" }
          : {
              code: 0,
              stdout: JSON.stringify({ data: { repository: prState().repo } }),
              stderr: "",
            },
    }),
    () => true,
    "T",
    "B",
    true,
  );
  out.createPr.mutationCodeFail = await run(
    prState({
      gh: (args) =>
        args.some((a) => a.startsWith("query=mutation"))
          ? { code: 1, stderr: "http 500", stdout: "" }
          : {
              code: 0,
              stdout: JSON.stringify({ data: { repository: prState().repo } }),
              stderr: "",
            },
    }),
    () => true,
    "T",
    "B",
    true,
  );

  const recorded: unknown = JSON.parse(JSON.stringify(out));
  assert.deepStrictEqual(recorded, JSON.parse(readFileSync(GOLDEN, "utf8")));
});
