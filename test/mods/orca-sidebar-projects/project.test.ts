import { afterEach, beforeEach, test, vi } from "vite-plus/test";
import assert from "node:assert/strict";
import type { Context } from "gpui-kit";
import {
  clearAgentConfigRuntime,
  setAgentConfigRuntime,
} from "../../support/agent-config-runtime.js";
import {
  avatarFile,
  avatarUrlFor,
  ensureAvatar,
  parseRemote,
  repoMark,
  tint,
} from "../../../src/mods/orca-sidebar-projects/project.js";

type Rec = { n: string; a: unknown[]; c: [string, unknown[]][] };
const host = vi.hoisted(() => ({
  codes: {} as Record<string, number>,
  throws: new Set<string>(),
  calls: [] as [string, string[]][],
}));

vi.mock("herdr", () => ({
  appHome: () => "/home/app",
  exec: async (command: string, args: string[] = []) => {
    host.calls.push([command, args]);
    if (host.throws.has(command)) throw new Error("exec failed");
    return { code: host.codes[command] ?? 0, stdout: "", stderr: "" };
  },
}));

type Job = (cx: { notify(): void }) => Promise<void>;

function fakeCx() {
  const jobs: Job[] = [];
  let notified = 0;
  const cx = {
    spawn(body: Job) {
      jobs.push(body);
    },
  };
  return {
    cx: cx as unknown as Context,
    jobs,
    run: async () => {
      for (const job of jobs.splice(0)) await job({ notify: () => notified++ });
    },
    notified: () => notified,
  };
}

const commandsRun = () => host.calls.map(([command]) => command);

beforeEach(() => {
  setAgentConfigRuntime({ key: "project", argv: [] });
  host.codes = {};
  host.throws = new Set();
  host.calls = [];
});

afterEach(() => {
  clearAgentConfigRuntime();
});

test("a name tints to one stable colour per theme, folded the way T3 folds it", () => {
  assert.equal(tint("a", true), "#34d399");
  assert.equal(tint("a", false), "#059669");
  assert.equal(tint("  A ", true), tint("a", true));
  assert.equal(tint("ﬁle", false), tint("file", false));
  assert.equal(tint("", true), tint("project", true));
  assert.notEqual(tint("a", true), tint("a", false));
});

test("remote URLs and SCP-style remotes name a host, owner and repo", () => {
  assert.deepEqual(parseRemote("ssh://git@github.com:22/owner/repo.git"), {
    host: "github.com",
    owner: "owner",
    repo: "repo",
  });
  assert.deepEqual(parseRemote("git+https://GitHub.com/owner/repo/"), {
    host: "github.com",
    owner: "owner",
    repo: "repo",
  });
  assert.deepEqual(parseRemote("git@GitHub.com:owner/repo.git"), {
    host: "github.com",
    owner: "owner",
    repo: "repo",
  });
  assert.deepEqual(parseRemote("git@github.com:owner/repo/"), {
    host: "github.com",
    owner: "owner",
    repo: "repo",
  });
});

test("remotes without a usable owner and repo name nothing", () => {
  assert.equal(parseRemote("https://github.com/owner"), null);
  assert.equal(parseRemote("https://github.com/bad owner/repo"), null);
  assert.equal(parseRemote("ssh://[::1"), null);
  assert.equal(parseRemote("git@github.com:bad owner/repo"), null);
  assert.equal(parseRemote("git@github.com:bad!owner/repo"), null);
  assert.equal(parseRemote("no-scheme-no-colon"), null);
  assert.equal(parseRemote("   "), null);
  assert.equal(parseRemote(null), null);
  assert.equal(parseRemote(undefined), null);
});

test("an owner GitHub can serve gets its avatar URL, anything else gets none", () => {
  assert.equal(
    avatarUrlFor({ host: "github.com", owner: "owner" }),
    "https://github.com/owner.png?size=64",
  );
  assert.equal(avatarUrlFor({ host: "github.com", owner: "bad_owner" }), null);
});

test("a missing URL or one already tried starts no avatar job", () => {
  const { cx, jobs } = fakeCx();
  ensureAvatar(null, cx);
  ensureAvatar("", cx);
  ensureAvatar(undefined, cx);
  assert.equal(jobs.length, 0);
  ensureAvatar("https://avatars.test/once.png", cx);
  ensureAvatar("https://avatars.test/once.png", cx);
  assert.equal(jobs.length, 1);
});

test("an avatar already on disk is shown without downloading it again", async () => {
  const url = "https://avatars.test/present.png";
  const { cx, run, notified } = fakeCx();
  ensureAvatar(url, cx);
  await run();
  assert.deepEqual(commandsRun(), ["mkdir", "test"]);
  assert.equal(notified(), 1);
  assert.match(avatarFile(url) ?? "", /^avatars\/.*\.png$/);
});

test("a missing avatar is downloaded, converted to PNG, and the temp file removed", async () => {
  const url = "https://avatars.test/fresh.png";
  host.codes = { test: 1 };
  const { cx, run, notified } = fakeCx();
  ensureAvatar(url, cx);
  await run();
  assert.deepEqual(commandsRun(), ["mkdir", "test", "curl", "convert", "rm"]);
  const rel = avatarFile(url);
  assert.ok(rel);
  assert.deepEqual(host.calls.at(-1), ["rm", ["-f", `/home/app/${rel}.tmp`]]);
  assert.equal(notified(), 1);
});

test("a download that is not an image is moved into place as it is", async () => {
  const url = "https://avatars.test/raw.png";
  host.codes = { test: 1, convert: 1 };
  const { cx, run } = fakeCx();
  ensureAvatar(url, cx);
  await run();
  assert.deepEqual(commandsRun(), ["mkdir", "test", "curl", "convert", "mv"]);
  const rel = avatarFile(url);
  assert.deepEqual(host.calls.at(-1), ["mv", [`/home/app/${rel}.tmp`, `/home/app/${rel}`]]);
});

test("a failed download leaves no avatar and notifies nothing", async () => {
  const url = "https://avatars.test/offline.png";
  host.codes = { test: 1, curl: 22 };
  const { cx, run, notified } = fakeCx();
  ensureAvatar(url, cx);
  await run();
  assert.deepEqual(commandsRun(), ["mkdir", "test", "curl"]);
  assert.equal(avatarFile(url), null);
  assert.equal(notified(), 0);
});

test("an exec that throws ends the job quietly", async () => {
  const url = "https://avatars.test/throws.png";
  host.throws = new Set(["mkdir"]);
  const { cx, run, notified } = fakeCx();
  ensureAvatar(url, cx);
  await run();
  assert.equal(avatarFile(url), null);
  assert.equal(notified(), 0);
});

function markOf(size: number, url: string | null): Rec {
  return (repoMark(size, url) as unknown as { __node: Rec }).__node;
}

test("repoMark draws the repo's avatar when it exists, else a grey folder", async () => {
  const missing = markOf(16, "https://avatars.test/unseen.png");
  const folder = missing.c.find(([call]) => call === "child")?.[1][0] as Rec;
  assert.equal(folder.n, "svg");
  assert.deepEqual(folder.a, ["mods/orca-assets/folder--orca-sidebar-projects.svg"]);
  assert.deepEqual(folder.c.find(([call]) => call === "text_color")?.[1], ["#737373"]);
  assert.deepEqual(folder.c.find(([call]) => call === "size")?.[1], [14]);

  const url = "https://avatars.test/ready.png";
  const { cx, run } = fakeCx();
  ensureAvatar(url, cx);
  await run();
  const shown = markOf(16, url);
  const image = shown.c.find(([call]) => call === "child")?.[1][0] as Rec;
  assert.equal(image.n, "image");
  assert.deepEqual(image.a, [avatarFile(url)]);
  assert.deepEqual(image.c.find(([call]) => call === "size")?.[1], [16]);
});
