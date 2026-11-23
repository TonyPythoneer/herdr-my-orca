// Golden test: the argv each flyout agent hands to `tab.new`, pinned before the flyout moved to a
// data spec. Every expectation here was read off the pre-spec launch(), so the spec must reproduce
// it exactly.
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register(new URL("../../scripts/gpui-stub-loader.mjs", import.meta.url));
const { default: Flyout } = await import("./main.js");
const { SPECS, defaultValues } = await import("./agent-flyout.js");

const cx = { notify() {} };
const input = (value) => ({ value: () => value });

function flyout(key, argv, state = {}, files = new Map()) {
  globalThis.__herdrFiles = files;
  globalThis.__herdrProps = () => ({ key, space: "s1", name: key, argv });
  globalThis.__herdrSpaces = () => [{ id: "s1", active: true, machine: null }];
  const runs = [];
  globalThis.__herdrRun = (command, args) => runs.push([command, args]);
  const view = Object.create(Flyout.prototype);
  const { model = "m", effort = "high", advisorModel, outputStyle, agentsInput, promptInput, codexOff, ...rest } = state;
  const spec = SPECS[key];
  const values = { ...defaultValues(spec), model, effort, advisorModel: "none", outputStyle: "default", agents: "", systemPrompt: "" };
  if (advisorModel !== undefined) values.advisorModel = advisorModel;
  if (outputStyle !== undefined) values.outputStyle = outputStyle;
  if (codexOff) values.codexOff = [...codexOff];
  Object.assign(view, {
    key,
    spec,
    values,
    models: [{ id: model, label: "M", efforts: [], fallbackEffort: "high" }],
    editors: key === "claude" || key === "pi" ? { ...(key === "claude" ? { agents: { input: agentsInput ?? input(""), dirty: false, error: null } } : {}), systemPrompt: { input: promptInput ?? input(""), dirty: false, error: null } } : {},
    hidden: new Set(),
    providerId: "none",
    providers: {},
    launching: false,
    error: "",
    snapshot: null,
    ...rest,
  });
  return { view, runs, files };
}
const argvOf = (runs) => runs.find((call) => call[0] === "tab.new")?.[1]?.argv;

const CLAUDE = ["claude", "--dangerously-skip-permissions"];

test("claude: model and effort only, nothing else when the advanced options are at rest", async () => {
  const { view, runs } = flyout("claude", CLAUDE, { model: "sonnet", effort: "high" });
  await view.launch(cx);
  assert.deepEqual(argvOf(runs), [...CLAUDE, "--model", "sonnet", "--effort", "high"]);
});

test("claude: a model without effort passes no --effort", async () => {
  const { view, runs } = flyout("claude", CLAUDE, { model: "haiku", effort: "" });
  await view.launch(cx);
  assert.deepEqual(argvOf(runs), [...CLAUDE, "--model", "haiku"]);
});

test("claude: advisor, style, agents and prompt come last, in that order", async () => {
  const { view, runs } = flyout("claude", CLAUDE, {
    model: "opus",
    effort: "max",
    advisorModel: "opus",
    outputStyle: "eli5",
    agentsInput: input('{"scout":{"description":"d"}}'),
    promptInput: input("You are the primary agent."),
  });
  await view.launch(cx);
  assert.deepEqual(argvOf(runs), [
    ...CLAUDE,
    "--model", "opus",
    "--effort", "max",
    "--advisor", "opus",
    "--settings", '{"outputStyle":"eli5"}',
    "--agents", '{"scout":{"description":"d"}}',
    "--append-system-prompt", "You are the primary agent.",
  ]);
});

test("claude: advisor none and style default add nothing; blank agents and prompt add nothing", async () => {
  const { view, runs } = flyout("claude", CLAUDE, { model: "opus", effort: "low", agentsInput: input("  \n"), promptInput: input("   ") });
  await view.launch(cx);
  assert.deepEqual(argvOf(runs), [...CLAUDE, "--model", "opus", "--effort", "low"]);
});

test("claude: invalid agents JSON blocks the launch and names the line", async () => {
  const { view, runs } = flyout("claude", CLAUDE, { agentsInput: input('{\n  "a": \n}') });
  await view.launch(cx);
  assert.equal(argvOf(runs), undefined);
  assert.ok(view.editors.agents.error?.line >= 1);
  assert.equal(view.launching, false);
});

test("codex: --disable per ticked flag in catalog order, then one -c per config.toml MCP server", async () => {
  const toml = '[mcp_servers.foo]\ncommand = "x"\n[mcp_servers."bar baz"]\ncommand = "y"\n[other]\nk = 1\n';
  const { view, runs } = flyout(
    "codex",
    ["codex", "--no-daemon"],
    { model: "gpt-5.6-sol", effort: "high", codexOff: new Set(["apps", "mcp", "plugins"]) },
    new Map([["/home/.codex/config.toml", toml]]),
  );
  await view.launch(cx);
  assert.deepEqual(argvOf(runs), [
    "codex", "--no-daemon",
    "-m", "gpt-5.6-sol", "-c", "model_reasoning_effort=high",
    "--disable", "plugins",
    "--disable", "apps",
    "-c", "mcp_servers.foo.enabled=false",
    "-c", 'mcp_servers."bar baz".enabled=false',
  ]);
});

test("codex: nothing ticked adds nothing, and a missing config.toml disables no server", async () => {
  const { view, runs } = flyout("codex", ["codex"], { model: "gpt-5.6-sol", effort: "low", codexOff: new Set(["mcp"]) });
  await view.launch(cx);
  assert.deepEqual(argvOf(runs), ["codex", "-m", "gpt-5.6-sol", "-c", "model_reasoning_effort=low"]);
});

test("opencode: the model rides in the environment and the TUI runs its own server", async () => {
  const { view, runs, files } = flyout("opencode", ["opencode"], { model: "opencode/big-pickle", effort: "high" });
  await view.launch(cx);
  assert.deepEqual(argvOf(runs), ["env", 'OPENCODE_CONFIG_CONTENT={"model":"opencode/big-pickle"}', "opencode", "--standalone"]);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(JSON.parse(files.get("/home/.local/state/opencode/model.json")), { variant: { "opencode/big-pickle": "high" } });
});

test("pi: --model, --thinking, the ticked --no-* switches and the appended prompt, in spec order", async () => {
  const { view, runs } = flyout("pi", ["pi"], { model: "radius/balanced", effort: "high", promptInput: input("Be brief.") });
  view.values.off = ["session", "extensions"];
  await view.launch(cx);
  assert.deepEqual(argvOf(runs), ["pi", "--model", "radius/balanced", "--thinking", "high", "--no-extensions", "--no-session", "--append-system-prompt", "Be brief."]);
});

test("pi: the Default entry starts pi on its own model, with no model or thinking flag", async () => {
  const { view, runs } = flyout("pi", ["pi"], { model: "", effort: "", promptInput: input("") });
  await view.launch(cx);
  assert.deepEqual(argvOf(runs), ["pi"]);
});

test("pi: a model that does not think gets no --thinking", async () => {
  const { view, runs } = flyout("pi", ["pi"], { model: "omlx/x", effort: "", promptInput: input("") });
  await view.launch(cx);
  assert.deepEqual(argvOf(runs), ["pi", "--model", "omlx/x"]);
});

test("pi: when the model list cannot be read, the Default entry is still there to launch", async () => {
  const { view } = flyout("pi", ["pi"]);
  globalThis.__herdrExec = async () => { throw new Error("not installed"); };
  assert.deepEqual(await view.listModels(), [{ id: "", label: "Default", efforts: [], fallbackEffort: "" }]);
  // an agent without a default entry reports the failure instead
  const codex = flyout("codex", ["codex"]).view;
  globalThis.__herdrExec = async () => { throw new Error("not installed"); };
  await assert.rejects(() => codex.listModels(), /not installed/);
  delete globalThis.__herdrExec;
});
