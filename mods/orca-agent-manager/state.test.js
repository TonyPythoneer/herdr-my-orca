import test from "node:test";
import assert from "node:assert/strict";
import {
  BUILTIN_DEFAULTS,
  HOMEPAGES,
  applyFreshInstalled,
  argsEditable,
  argsFromText,
  argsToText,
  checkArgs,
  commandCheckScript,
  commandPathScript,
  listViewportHeight,
  parseCommandPath,
  defaultRun,
  draftRun,
  formatArgv,
  isBuiltinAgent,
  parseCommandCheck,
  parseManagerConfig,
  programsUpdate,
  readRunOverride,
  serializeManagerConfig,
  splitInventory,
  validateDraft,
  validateExecutable,
  writeRunOverride,
  writeRunOverrides,
} from "./state.js";

test("arguments keep spaces, quotes and backslashes byte for byte", () => {
  const argv = ["--flag=a b", `"quoted"`, "back\\slash", "single'quote", "$HOME", "two  spaces"];
  assert.deepEqual(argsFromText(argsToText(argv)), argv);
});

test("blank lines are not arguments, CRLF is accepted", () => {
  assert.deepEqual(argsFromText("\n--a\r\n\r\n--b\n\n"), ["--a", "--b"]);
  assert.deepEqual(argsFromText(""), []);
  assert.deepEqual(argsFromText(null), []);
});

test("validation keeps the executable and each argument apart", () => {
  assert.deepEqual(validateDraft("  /path/with space/claude  ", "--model\nopus"), {
    run: ["/path/with space/claude", "--model", "opus"],
  });
  assert.deepEqual(validateDraft("", ""), { error: "Enter the executable name or path." });
  assert.match(validateDraft("a\nb", "").error, /line break/);
});

test("preview quoting is display only and round-trippable by a shell", () => {
  assert.equal(formatArgv(["claude", "--model", "two words", "a'b"]), "claude --model 'two words' 'a'\\''b'");
});

test("an executable-only edit keeps empty and multi-line arguments intact", () => {
  assert.deepEqual(draftRun("newbin", "ignored", ["", "a\nb"]), { run: ["newbin", "", "a\nb"] });
  assert.deepEqual(draftRun("newbin", "--model\nopus", ["--old"]), { run: ["newbin", "--model", "opus"] });
  assert.match(draftRun("", "x", [""]).error, /executable/);
  assert.equal(argsEditable(["a", "b c"]), true);
  assert.equal(argsEditable([]), true);
  assert.equal(argsEditable([""]), false);
  assert.equal(argsEditable(["a\nb"]), false);
  assert.deepEqual(validateExecutable("  /opt/claude  "), { command: "/opt/claude" });
  assert.deepEqual(draftRun("newbin", "ignored", undefined), { run: ["newbin", "ignored"] });
});

test("a fresh programs.json read never replaces a dirty draft", () => {
  assert.deepEqual(programsUpdate(undefined, "{}", false), { kind: "apply", text: "{}" });
  assert.deepEqual(programsUpdate("a", "a", true), { kind: "none" });
  assert.deepEqual(programsUpdate("a", undefined, false), { kind: "none" });
  assert.deepEqual(programsUpdate("a", "b", true), { kind: "conflict", text: "b" });
  assert.deepEqual(programsUpdate("a", "b", false), { kind: "apply", text: "b" });
});

test("fish gets no extra $0 argument and POSIX keeps its placeholder", () => {
  assert.deepEqual(checkArgs("/bin/zsh", "SCRIPT", ["claude", "qodercli"]), [
    "-lic", "SCRIPT", "herdr-agent-manager", "claude", "qodercli",
  ]);
  assert.deepEqual(checkArgs("/opt/fish", "SCRIPT", ["claude"]), ["-lic", "SCRIPT", "claude"]);
  assert.deepEqual(checkArgs("/bin/bash", "SCRIPT", ["claude"], false), [
    "-lc", "SCRIPT", "herdr-agent-manager", "claude",
  ]);
});

test("each agent group is capped at 5.5 rows", () => {
  assert.equal(listViewportHeight(5), null);
  assert.equal(listViewportHeight(0), null);
  assert.equal(listViewportHeight(6), 5.5 * 56 + 2);
  assert.equal(listViewportHeight(20), 5.5 * 56 + 2);
  assert.equal(listViewportHeight(2, true), 5.5 * 56 + 2);
});

test("command path probing keeps the command out of the script and survives shell banners", () => {
  assert.deepEqual(commandPathScript("/bin/zsh"), 'command -v -- "$1"');
  assert.deepEqual(commandPathScript("/opt/fish"), "command -v -- $argv[1]");
  assert.equal(parseCommandPath("banner\n/opt/homebrew/bin/claude\n"), "/opt/homebrew/bin/claude");
  assert.equal(parseCommandPath("not found"), null);
});

test("built-in defaults cover the agents Herdr offers", () => {
  for (const key of Object.keys(BUILTIN_DEFAULTS)) {
    assert.ok(Array.isArray(defaultRun(key)) && defaultRun(key).length > 0);
    assert.ok(isBuiltinAgent(key));
    assert.match(HOMEPAGES[key], /^https:\/\//);
  }
  assert.equal(defaultRun("user-added"), null);
  assert.equal(isBuiltinAgent("user-added"), false);
  assert.ok(HOMEPAGES.claude.startsWith("https://"));
});

test("reads an override without treating other entries as errors", () => {
  const text = JSON.stringify({ programs: { claude: { run: ["my-claude", "--x"] }, other: { name: "X" } } });
  assert.deepEqual(readRunOverride(text, "claude").run, ["my-claude", "--x"]);
  assert.equal(readRunOverride(text, "other").run, null);
  assert.equal(readRunOverride(null, "claude").run, null);
});

test("malformed programs.json is reported and never rewritten", () => {
  assert.match(readRunOverride("{ nope", "claude").error, /not valid JSON/);
  assert.match(writeRunOverride("{ nope", "claude", ["claude"]).error, /not valid JSON/);
  assert.match(writeRunOverride('{"programs":[]}', "claude", ["claude"]).error, /must be an object/);
  assert.match(
    readRunOverride('{"programs":{"claude":{"run":"claude"}}}', "claude").error,
    /non-empty array of strings/,
  );
  assert.match(
    writeRunOverride('{"programs":{"claude":42}}', "claude", ["claude"]).error,
    /entry must be an object/,
  );
});

test("writing one run preserves unrelated fields, entries and key order", () => {
  const before = `${JSON.stringify(
    {
      programs: {
        omp: { name: "OMP", icon: "icons/omp.svg", run: ["omp"] },
        claude: { name: "Claude", custom: { keep: true } },
      },
      shells: ["xonsh"],
    },
    null,
    2,
  )}\n`;
  const written = writeRunOverride(before, "claude", ["/opt/claude bin/claude", "--model", "two words"]);
  assert.equal(written.error, undefined);
  const after = JSON.parse(written.text);
  assert.deepEqual(after.programs.claude.run, ["/opt/claude bin/claude", "--model", "two words"]);
  assert.deepEqual(after.programs.claude.custom, { keep: true });
  assert.equal(after.programs.claude.name, "Claude");
  assert.deepEqual(after.programs.omp, { name: "OMP", icon: "icons/omp.svg", run: ["omp"] });
  assert.deepEqual(after.shells, ["xonsh"]);
  assert.deepEqual(Object.keys(after.programs), ["omp", "claude"]);
});

test("reset removes only the run and drops a now-empty entry", () => {
  const before = JSON.stringify({ programs: { claude: { run: ["x"] }, codex: { run: ["y"], name: "C" } } });
  const one = writeRunOverride(before, "claude", null);
  assert.deepEqual(JSON.parse(one.text).programs, { codex: { run: ["y"], name: "C" } });
  const two = writeRunOverride(before, "codex", null);
  assert.deepEqual(JSON.parse(two.text).programs, { claude: { run: ["x"] }, codex: { name: "C" } });
});

test("manager config stores only disabled keys and rejects damage", () => {
  assert.deepEqual([...parseManagerConfig(null).disabled], []);
  assert.deepEqual([...parseManagerConfig('{"disabled":["codex","claude"]}').disabled].sort(), ["claude", "codex"]);
  assert.match(parseManagerConfig("{ nope").error, /not valid JSON/);
  assert.match(parseManagerConfig('{"disabled":"claude"}').error, /array of agent keys/);
  assert.equal(serializeManagerConfig(new Set(["codex", "claude"])), '{\n  "version": 1,\n  "disabled": [\n    "claude",\n    "codex"\n  ]\n}\n');
});

test("a manager file without permissions reads as each agent's own settings", () => {
  assert.deepEqual(parseManagerConfig(undefined).permissions, { default: "own", overrides: {} });
  assert.deepEqual(parseManagerConfig('{"version":1,"disabled":[]}').permissions, { default: "own", overrides: {} });
  assert.deepEqual(
    parseManagerConfig('{"permissions":{"default":"ask","overrides":{"claude":"full-access"}}}').permissions,
    { default: "ask", overrides: { claude: "full-access" } },
  );
  assert.match(parseManagerConfig('{"permissions":{"default":"yolo"}}').error, /permissions.default/);
});

test("permissions round-trip and stay out of the file until they are set", () => {
  const none = serializeManagerConfig(new Set(), { default: "own", overrides: {} });
  assert.doesNotMatch(none, /permissions/);
  assert.equal(none, serializeManagerConfig(new Set()));

  const set = serializeManagerConfig(new Set(["omp"]), { default: "ask", overrides: { claude: "full-access" } });
  assert.deepEqual(JSON.parse(set), {
    version: 1,
    disabled: ["omp"],
    permissions: { default: "ask", overrides: { claude: "full-access" } },
  });
  assert.deepEqual(parseManagerConfig(set).permissions, { default: "ask", overrides: { claude: "full-access" } });

  // Overrides are sorted so two equal states always write the same bytes.
  const sorted = serializeManagerConfig(new Set(), { default: "own", overrides: { grok: "ask", claude: "ask" } });
  assert.deepEqual(Object.keys(JSON.parse(sorted).permissions.overrides), ["claude", "grok"]);
});

test("a batch run write applies every entry in one parse and refuses a half write", () => {
  const before = JSON.stringify({
    programs: { claude: { name: "Claude", run: ["claude"] }, codex: { run: ["codex"] } },
  });
  const written = writeRunOverrides(before, [
    ["claude", ["claude", "--permission-mode", "ask"]],
    ["codex", null],
  ]);
  const after = JSON.parse(written.text);
  assert.deepEqual(after.programs.claude, { name: "Claude", run: ["claude", "--permission-mode", "ask"] });
  // A run that was an entry's only field takes the entry with it, as a single reset does.
  assert.equal(after.programs.codex, undefined);
  assert.equal(written.changed, true);

  // One bad entry leaves the whole file exactly as it was.
  const refused = writeRunOverrides(before, [
    ["claude", ["claude"]],
    ["codex", []],
  ]);
  assert.match(refused.error, /needs an executable/);
  assert.equal(refused.text, undefined);
  assert.equal(writeRunOverride(before, "claude", ["claude"]).changed, true);
});

const AGENTS = [
  { key: "claude", installed: true },
  { key: "codex", installed: false },
  { key: "opencode", installed: true },
];

test("a disabled agent is never misclassified as missing", () => {
  const { installed, available } = splitInventory(AGENTS, new Set(["claude", "codex"]));
  assert.deepEqual(installed.map((a) => [a.key, a.enabled]), [["claude", false], ["opencode", true]]);
  assert.deepEqual(available.map((a) => [a.key, a.enabled]), [["codex", false]]);
});

test("an uninstalled agent's switch is unavailable even when it was never disabled", () => {
  const { installed, available } = splitInventory(AGENTS, new Set());
  assert.deepEqual(installed.map((a) => [a.key, a.enabled]), [["claude", true], ["opencode", true]]);
  assert.deepEqual(available.map((a) => [a.key, a.enabled]), [["codex", false]]);
});

test("fresh checks change only the installed flag", () => {
  const fresh = new Map([["claude", false], ["codex", true]]);
  const next = applyFreshInstalled(AGENTS, fresh);
  assert.deepEqual(next, [
    { key: "claude", installed: false },
    { key: "codex", installed: true },
    { key: "opencode", installed: true },
  ]);
});

test("the fresh check script passes commands as arguments, never as code", () => {
  const script = commandCheckScript("/bin/zsh");
  assert.match(script, /"\$@"/);
  assert.doesNotMatch(script, /echo/);
  assert.match(commandCheckScript("/opt/fish/bin/fish"), /\$argv/);
});

test("fresh check output ignores login-shell noise and demands every answer", () => {
  assert.deepEqual(parseCommandCheck("Welcome!\nHERDRAM:1\nnoise\nHERDRAM:0\n", 2), [true, false]);
  assert.throws(() => parseCommandCheck("HERDRAM:1\n", 2), /answered 1 of 2/);
});
