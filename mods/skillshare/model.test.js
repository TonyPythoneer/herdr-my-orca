// Characterization tests for model.js (pure functions). Seeded random inputs are fed to the
// functions and every output is compared with a digest recorded from the code as it was before
// the refactor. Named *-test.js (not *.test.js): the in-place map in orca-ui/app.mjs lists *.test.js files.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as M from "./model.js";

function rng(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const R = rng(20260101);
const pick = (list) => list[Math.floor(R() * list.length)];
const maybe = (p, make) => (R() < p ? make() : undefined);
const some = (max, make) => Array.from({ length: Math.floor(R() * (max + 1)) }, make);

// Canonical text of a value: Maps and Sets as arrays, keys sorted, undefined kept visible.
const canon = (value) => JSON.stringify(value, (_k, v) => {
  if (v === undefined) return "__undefined";
  if (v instanceof Map) return { __map: [...v] };
  if (v instanceof Set) return { __set: [...v] };
  if (v && typeof v === "object" && !Array.isArray(v)) return Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1)));
  return v;
});
const digest = (values) => createHash("sha256").update(canon(values)).digest("hex");

const NAMES = ["search", "plan.md", "a/b/deep", "Zed", "alpha", "beta.md", "docs/guide"];
const TARGETS = ["claude", "codex", "cursor", "claude-unno", "omp"];
const SOURCES = ["https://github.com/o/r.git", "github.com/o/r/skills/x", "https://gitlab.com/g/h/i/j", "local", "", "/abs/path/", "ssh://host/x.git"];
const ACTIONS = ["add", "modify", "unchanged", "inactive", "remove", "update", "adopt", "release", "conflict", "other"];

const diffItem = () => ({ name: pick(NAMES), kind: pick(["agent", "skill", undefined]), action: pick(ACTIONS), reason: maybe(0.5, () => pick(["new", "changed"])), is_sync: R() < 0.8 });
const diffOf = () => ({ targets: some(3, () => ({ name: pick(TARGETS), items: maybe(0.9, () => some(4, diffItem)) })) });
const hookChange = () => ({ name: maybe(0.6, () => pick(["fmt", "lint", "guard"])), root: maybe(0.3, () => pick(["", "p1", "p2"])), target: maybe(0.7, () => pick(TARGETS)), action: pick(ACTIONS),
  message: maybe(0.4, () => pick(["m1", "m2"])), inactiveReason: maybe(0.3, () => pick(["off", "m1"])) });
const hookEntries = () => Object.fromEntries(some(3, () => [pick(["fmt", "lint", "guard"]), { enabled: pick([true, false, undefined]), description: maybe(0.5, () => "d"), bindings: maybe(0.8, () => Object.fromEntries(some(2, () => [pick(TARGETS), {}]))) }]));
const raw = (scope) => ({
  list: pick([null, undefined, "x", some(5, () => ({ name: pick(NAMES), kind: pick(["agent", "skill", undefined]), relPath: maybe(0.5, () => pick(NAMES)), source: maybe(0.6, () => pick(SOURCES)), repoName: maybe(0.3, () => pick(["tr1", "tr2"])), disabled: maybe(0.2, () => true) }))]),
  check: maybe(0.7, () => ({ skills: maybe(0.9, () => some(3, () => ({ name: pick(NAMES), status: pick(["update_available", "up_to_date"]), source: maybe(0.5, () => pick(SOURCES)), version: maybe(0.5, () => "1.2") }))),
    tracked_repos: maybe(0.7, () => some(2, () => ({ name: pick(["tr1", "tr2"]), status: pick(["behind", "ok"]), behind: maybe(0.7, () => 2) }))) })),
  checkAgents: pick([null, "x", some(3, () => ({ name: pick(NAMES), status: pick(["update_available", "up_to_date"]), source: maybe(0.5, () => pick(SOURCES)) }))]),
  diff: maybe(0.8, diffOf),
  mcp: maybe(0.6, () => ({ changes: maybe(0.9, () => some(5, () => ({ name: pick(["m1", "m2"]), target: pick(TARGETS), action: maybe(0.8, () => pick(["add", "unchanged", "update"])) }))) })),
  plugins: maybe(0.6, () => ({ packages: Object.fromEntries(some(3, () => [pick(["p1", "p2", "p3"]), { source: maybe(0.5, () => pick(SOURCES)), version: maybe(0.5, () => "2.0"),
    bindings: maybe(0.8, () => Object.fromEntries(some(3, () => [pick(TARGETS), { pending: maybe(0.3, () => true), sync: pick([true, false, undefined]), id: maybe(0.5, () => pick(SOURCES)), version: maybe(0.3, () => "3") }]))) }])) })),
  hooks: maybe(0.8, () => ({ source: maybe(0.8, () => ({ entries: hookEntries(), projects: maybe(0.5, () => Object.fromEntries(some(2, () => [pick(["p1", "p2"]), { entries: hookEntries() }]))) })),
    plan: maybe(0.8, () => ({ changes: maybe(0.9, () => some(5, hookChange)), warnings: maybe(0.5, () => some(2, () => pick(["w1", "w2"]))) })),
    error: maybe(0.15, () => "boom"), previewError: maybe(0.1, () => "preview") })),
  root: maybe(0.7, () => pick(["/proj", "C:\\proj", "/Users/x/proj", "/"])),
  targetPaths: maybe(0.8, () => some(4, () => ({ name: pick(TARGETS), path: pick(["/Users/x/.claude/skills", "/proj/.claude/skills", "C:\\proj\\.claude\\skills", "/Users/x/.codex/skills", ".claude/skills", "/.cursor/skills"]) }))),
  extras: pick([null, "x", some(4, () => ({ name: pick(["rules", "cfg", "notes"]), file: maybe(0.3, () => "f.txt"), source_exists: pick([true, false, undefined]), source_dir: "/src/x", file_count: maybe(0.7, () => pick([0, 1, 5])),
    targets: maybe(0.9, () => some(3, () => ({ path: pick(["/proj/.claude/a", "/Users/x/.claude/b", ".codex/c", "/other"]), status: pick(["synced", "no source", "drift", "missing"]), mode: maybe(0.5, () => "symlink"), as: maybe(0.3, () => "AGENTS.md") }))) }))]),
  memory: maybe(0.5, () => ({ root: "/mem", notes: maybe(0.9, () => some(3, () => ({ path: pick(["a.md", "b/c.md"]) }))) })),
  pending: maybe(0.3, () => some(3, () => pick(["list", "diff", "status", "mcp", "memory", "hooks"]))),
  errors: maybe(0.3, () => Object.fromEntries(some(2, () => [pick(["list", "diff", "extras", "mcp", "memory"]), "bad"]))),
  scope,
});

const CASES = 700;
const scopes = ["project", "global"];
const built = [];
for (let n = 0; n < CASES; n++) { const scope = pick(scopes), r = raw(scope); built.push({ scope, r, items: M.buildItems(scope, r) }); }
const allItems = built.flatMap((b) => b.items);

const GOLDEN = {
  buildItems: "f601313cc134a1a4aa9337d8e1d90e0b06e59dfea03032909b6b4d3a45d29dcc",
  previewTargets: "2eecd50e4f1a910492241b1ef37bd0c20ea658846d3be514f8c9ed1bebc4c47b",
  rowState: "29711bb27fbbca41bc9fefa45ce556dbc1384afd75a3e43a0a3a1a03a9dabf96",
  eligibleTargets: "3fb79b18df30ef3761719e6b61a080f3047d15c3933b9547b24c6789bf22558c",
  "filter-group-count": "7ea9bc7a894cb42b92a9776a40b303228d34d8f7ac98b35d9a55d90a3c5a67b7",
  "toggle-hook-args": "917d4b9ae5cb78935f4409dfba67925c7c67a5fd6fa2db7394b6997a9e2b91ee",
  targetList: "9129ba01cac62015c3750d8affc3db78b75026999369767cd31f35393e55571a",
  syncScopes: "27d0205cfaa82c738c92fd476b48a49e6d608f77c7bf0a6619dc3d1e6fefa808",
  resourceProgress: "4da1d161d6cbc5e3c0c57f5451408f1daa6745e18c32b974acd68f9fad3c894c",
  driftFrom: "1a807afdc0d2461b0fc6439b41617499bbf50187558251dcae97f6616a47b7e1",
  overviewAnswer: "ee58e25806a4f609fcf76d422a9b986d864335210737607281eceea3d8ebc3cc",
  optimistic: "36a0727981bf5676beb5a90864caa48f60d097bb8850eef38acf4837af1d45d9",
  parseGitStatus: "30f45670305830a168f3c5a4b88474d1889d55f94d99fe11b0860d0fc8195a86",
  sourceLine: "a3abbe541b4e43e27b8b1aeca3b757c4f9dca911f9930562554a96df73e343c8",
  installResult: "26e1f453ce4dd5194b012ff7af976807da4bf6da4cf17a2e6adf8c67736a6903",
  failure: "4313512123e0072805072ef5c09ce16f39dd5cc33f871f4592ba294e31a02fc8",
  parseAudit: "c82da5e6b97f1832cf663a4f1092ef3bd23843ca500f035417cce681b6cde23d",
  parseDiscover: "02fc9ce90fce6e3c18f492532ecf03d207d2c23160599b4c636a43548c993909",
  mcpServer: "c128470781fc6bd81fc191302de7d72fa377067c33c021e92793a11e2ebb8dbf",
  diffSides: "df257a0e10edc58b083df87bee7c86776d0a6d36a115caa1c1851ce10aab5412",
  parsePreview: "f861a2899eabe6f01ac3986fe812afcb41ca49a5c22b2d5175e189c86e0372a6",
  frontmatter: "2509cbf1e2493e6147be3a4939f19ab760a24f551c2a77a302ac0a104f17ebc9",
  cloneUrl: "96f2d0e4f9725e293583694456efd556d682c7c41119f70adec6c12c573ea747",
};

function check(name, values) {
  const actual = digest(values);
  if (process.env.PRINT_GOLDEN) console.log(`GOLDEN ${name} ${actual}`);
  else assert.equal(actual, GOLDEN[name], name);
}

test("rows built from the CLI's JSON", () => {
  assert.ok(allItems.length > 1000);
  check("buildItems", built.map((b) => b.items));
});

test("rows through every view function", () => {
  const names = TARGETS.slice(0, 3);
  const itemsOf = (b) => b.items;
  check("previewTargets", allItems.map((i) => M.previewTargets(i, names)));
  check("rowState", allItems.flatMap((i) => [M.rowState(i, true), M.rowState(i, false)]));
  check("eligibleTargets", allItems.map((i) => M.eligibleTargets(i, pick([undefined, { agentTargets: ["a", "b"], skillTargets: pick([[], ["s"]]), diff: diffOf() }]))));
  check("filter-group-count", built.map((b) => {
    const items = itemsOf(b), query = pick(["", "a", "no-such", "fmt"]);
    return [M.filterItems(items, { scope: pick(["all", "project", "global"]), kind: pick([undefined, "skills", "hooks", "mcp"]), query }),
      M.groupItems(items), M.sourceGroups(items), M.counts(items), items.map((i) => [M.waitsForSync(i), M.needsLook(i)])];
  }));
  check("toggle-hook-args", allItems.flatMap((i) => ["enable", "disable", "remove", "x"].map((a) => [M.toggleArgs(i, a), M.hookArgs(i, a)])));
});

test("targets, scopes and the overview answer", () => {
  const wrap = built.map((b) => ({ project: b.scope === "project" ? b.r : { ...b.r, diff: diffOf(), targets: some(3, () => pick(TARGETS)) }, global: { ...b.r, scope: undefined } }));
  check("targetList", built.flatMap((b, n) => ["all", "project", "global"].map((s) => M.targetList(wrap[n], s, b.items))));
  check("syncScopes", built.flatMap((b, n) => ["all", "project", "global"].map((s) => M.syncScopes(b.items, wrap[n], s))));
  check("resourceProgress", built.flatMap((_b, n) => ["all", "project", "global"].map((s) => M.resourceProgress(wrap[n], s))));
  check("driftFrom", built.map((b) => [M.driftFrom(b.r.diff), M.targetDrift(b.r.diff)]));
  const answers = [];
  for (let n = 0; n < 600; n++) {
    answers.push(M.overviewAnswer({ loading: maybe(0.1, () => true), failed: maybe(0.1, () => true), error: maybe(0.5, () => "e"), moving: maybe(0.2, () => true),
      reading: maybe(0.8, () => some(2, () => pick(["list", "diff"]))), incomplete: maybe(0.2, () => true), pending: maybe(0.7, () => pick([0, 1, 4])),
      lag: maybe(0.8, () => some(4, () => ({ name: pick(TARGETS) }))), total: maybe(0.8, () => pick([0, 1, 9])), targets: maybe(0.8, () => pick([0, 1, 3])), broken: maybe(0.5, () => pick([0, 1, 2])) }));
  }
  answers.push(M.overviewAnswer({}));
  check("overviewAnswer", answers);
});

test("rows as a running request will leave them", () => {
  const outcomes = [];
  for (const b of built.slice(0, 200)) {
    const items = b.items, first = pick(items.length ? items : [{}]);
    const req = { op: pick(["toggle", "hook", "uninstall", "update", "sync", "refresh", "x"]), item: first, action: pick(["enable", "disable", "remove"]), project: pick(["/p", null]),
      updates: some(2, () => ({ kind: pick(["skills", "agents"]), scope: pick(scopes), all: maybe(0.4, () => true), name: pick(NAMES) })), scopes: some(2, () => pick(scopes)), plugins: maybe(0.5, () => true),
      added: maybe(0.7, () => some(2, () => ({ scope: pick(scopes), name: pick(NAMES), source: pick(SOURCES) }))) };
    outcomes.push(M.optimistic(items, req, pick(["/p", "/q", undefined])));
    outcomes.push(M.shownRows(items, [{ ...req, on: "a" }, { ...req, op: "sync", on: null, ended: true }], pick(["a", null]), "/p"));
  }
  check("optimistic", outcomes);
});

const GIT = ["norepo", "", "top /r\n## main...origin/main [ahead 1, behind 2]\n M a\n?? b c\nA  d", "## No commits yet on dev\n", "## main\nxx", "top /r\n## feat...up [behind 3]\n D z", "## main...o/m [ahead 4]\n", "garbage\nlines here", "## x...y [gone]\n!! ignored"];
test("parsers of CLI and git output", () => {
  check("parseGitStatus", [...GIT, null, undefined].map((t) => M.parseGitStatus(t)));
  check("sourceLine", [null, { error: "x" }, { repo: false }, { repo: true, files: [], ahead: 0, behind: 0, upstream: "u" }, { repo: true, files: [1, 2], ahead: 1, behind: 2, upstream: null }, { repo: true, files: [], ahead: 0, behind: 1, upstream: "u" }].map(M.sourceLine));
  const installs = [];
  for (let n = 0; n < 300; n++) {
    const body = pick([undefined, { skills: some(2, () => "one") }, { skills: ["a"], failed: some(2, () => "f") }, { skills: ["a"], skipped: some(2, () => "s") }, { error: "bad" }, { skills: [] }]);
    installs.push(M.installResult({ code: pick([0, 0, 1, 2]), stdout: pick([JSON.stringify(body ?? null), "not json", ""]), stderr: pick(["", "line1\nfinal err", "\u001b[31mred\u001b[0m"]) }));
  }
  check("installResult", installs);
  check("failure", [[{ stdout: '{"error":"E"}' }, "w"], [{ stderr: "a\nb" }, "w"], [{ stdout: "o1\no2", code: 3 }, "w"], [{ code: 4 }, "w"], [undefined, "w"]].map(([r, w]) => M.failure(r, w)));
  const sev = ["CRITICAL", "HIGH", "LOW", "INFO", "MEDIUM", "x"];
  const audits = [];
  for (let n = 0; n < 200; n++) {
    const part = () => `@@ ${pick([".", "a", "x/y"])}\n${pick([JSON.stringify({ results: some(3, () => ({ isBlocked: R() < 0.7, findings: maybe(0.8, () => some(3, () => ({ severity: pick(sev), pattern: "p", file: pick(["/d/r/f.md", "g.md", undefined]), line: 2, snippet: maybe(0.5, () => "s"), message: maybe(0.5, () => "m") }))) })) }), "not json", "{}"])}\n`;
    audits.push(M.parseAudit(some(3, part).join(""), pick(["/d", null, undefined])));
  }
  audits.push(M.parseAudit("", "/d"), M.parseAudit(undefined));
  check("parseAudit", audits);
  check("parseDiscover", ['@dir /d\n{"planned":[{"name":"a","path":"."}]}', '{"error":"x"}', '{"planned":[{"name":"a"}]}', '{"planned":[{"name":"A","path":"."},{"name":"a","path":"b"}]}', "junk", "", undefined, '@dir /d\n{"x":1}'].map((t) => M.parseDiscover(t)));
});

const YAML = [
  "servers:\n  one:\n    command: run\n    args:\n      - a\n      - b\n    env:\n      KEY: secret\n      OTHER: x\n  two:\n    url: http://x\n    headers:\n      - Auth: tok\n    bearerToken: abc\n",
  "# note\nprojects:\n  p:\n    servers:\n      three:\n        command: z\n        args: [q, r]\nservers:\n  four:\n    command: w\n",
  "servers:\n  \"quoted\":\n    cmd: 'c'\n    env: {}\n",
  "other: 1\n", "", "servers:\n", "servers:\n  one:\n",
];
test("an MCP server's settings", () => {
  const out = [];
  for (const text of [...YAML, undefined]) for (const name of ["one", "two", "three", "four", "quoted", "none"]) out.push(M.mcpServer(text, name));
  check("mcpServer", out);
});

test("two versions of a file and the preview text around them", () => {
  const lines = () => some(8, () => pick(["a", "b", "c", "", "d"])).join("\n");
  const out = [];
  for (let n = 0; n < 150; n++) out.push(M.diffSides(pick([null, lines(), ""]), pick([null, lines()]), pick([undefined, 0, 1, 3])));
  check("diffSides", out);
  const previews = ["@@local a\nx\ny\n@@remote a\nz\n@@local b\n@@gone\n@@remote b\nq\n", "orphan\n@@local a\n1", "", undefined];
  check("parsePreview", previews.map((t) => M.parsePreview(t)));
  check("frontmatter", ["---\nname: S\ndesc: >\n  more\n  - x\n---\nbody", "no matter", "---\nk: 'v'\n---", undefined].map((t) => M.splitFrontmatter(t)));
  check("cloneUrl", ["o/r", "github.com/o/r/tree/main/x/y", "https://gitlab.com/g/h/i", "git@h:x", "", "a", "o/r/skills/s", "https://github.com/o/r.git"].map((s) => M.cloneUrl(s)));
});
