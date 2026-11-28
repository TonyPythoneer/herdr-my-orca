import { afterEach, test, vi } from "vite-plus/test";
import assert from "node:assert/strict";
import { SPECS, defaultValues } from "../../../src/shared/agent-flyout.js";
import {
  cx,
  flyoutView,
  input,
  installHost,
  resetHost,
  type FlyoutKey,
  type HostExec,
} from "./host.js";

type FlyoutState = {
  model?: string;
  effort?: string;
  advisorModel?: string;
  outputStyle?: string;
  agentsInput?: ReturnType<typeof input>;
  promptInput?: ReturnType<typeof input>;
  codexOff?: string[];
  exec?: HostExec;
  files?: Map<string, string>;
};

vi.mock("gpui-kit", async () => {
  const { recordedElement } = await import("../../stubs/gpui-recording.js");
  return {
    View: class {},
    div: () => recordedElement("div"),
    svg: (path: string) => recordedElement("svg", path),
    image: (path: string) => recordedElement("image", path),
  };
});
vi.mock("gpui-base", async (importOriginal) => {
  const actual = await importOriginal<typeof import("gpui-base")>();
  const { recordedElement } = await import("../../stubs/gpui-recording.js");
  return {
    ...actual,
    v_flex: () => recordedElement("v_flex"),
    h_flex: () => recordedElement("h_flex"),
    Scrollbar: { vertical: (...args: unknown[]) => recordedElement("Scrollbar.vertical", ...args) },
    HoverCard: { new: (...args: unknown[]) => recordedElement("HoverCard.new", ...args) },
    Textarea: { new: (...args: unknown[]) => recordedElement("Textarea.new", ...args) },
    Input: { new: (...args: unknown[]) => recordedElement("Input.new", ...args) },
  };
});

function flyout(key: FlyoutKey, argv: string[], state: FlyoutState = {}) {
  const {
    model = "m",
    effort = "high",
    advisorModel,
    outputStyle,
    agentsInput,
    promptInput,
    codexOff,
    exec,
    files = new Map<string, string>(),
  } = state;
  const host = installHost({
    files,
    exec,
    props: () => ({ key, space: "s1", name: key, argv }),
  });
  const spec = SPECS[key];
  const values: Record<string, unknown> = {
    ...defaultValues(spec),
    model,
    effort,
    advisorModel: "none",
    outputStyle: "default",
    agents: "",
    systemPrompt: "",
  };
  if (advisorModel !== undefined) values.advisorModel = advisorModel;
  if (outputStyle !== undefined) values.outputStyle = outputStyle;
  if (codexOff) values.codexOff = [...codexOff];
  const editors =
    key === "claude" || key === "pi"
      ? {
          ...(key === "claude"
            ? { agents: { input: agentsInput ?? input(""), dirty: false, error: null } }
            : {}),
          systemPrompt: { input: promptInput ?? input(""), dirty: false, error: null },
        }
      : {};
  const view = flyoutView(key, {
    values,
    models: [{ id: model, label: "M", efforts: [], fallbackEffort: "high" }],
    editors,
    hidden: new Set(),
    providerId: "none",
    providers: {},
    launching: false,
    error: "",
    snapshot: null,
  });
  return { view, runs: host.runs, files };
}

function argvOf(runs: [string, unknown][]): string[] | undefined {
  const call = runs.find(([command]) => command === "tab.new");
  const payload = call?.[1];
  return typeof payload === "object" && payload !== null && "argv" in payload
    ? (payload.argv as string[])
    : undefined;
}

const withManagerEnvironment = (argv: string[]) => ["env", "HERDR_ENV=1", ...argv];
const delay = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => resetHost());

const CLAUDE = ["claude", "--dangerously-skip-permissions"];

test("claude: model and effort only, nothing else when the advanced options are at rest", async () => {
  const { view, runs } = flyout("claude", CLAUDE, { model: "sonnet", effort: "high" });
  await view.launch(cx);
  assert.deepEqual(
    argvOf(runs),
    withManagerEnvironment([...CLAUDE, "--model", "sonnet", "--effort", "high"]),
  );
});

test("claude: a model without effort passes no --effort", async () => {
  const { view, runs } = flyout("claude", CLAUDE, { model: "haiku", effort: "" });
  await view.launch(cx);
  assert.deepEqual(argvOf(runs), withManagerEnvironment([...CLAUDE, "--model", "haiku"]));
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
  assert.deepEqual(
    argvOf(runs),
    withManagerEnvironment([
      ...CLAUDE,
      "--model",
      "opus",
      "--effort",
      "max",
      "--advisor",
      "opus",
      "--settings",
      '{"outputStyle":"eli5"}',
      "--agents",
      '{"scout":{"description":"d"}}',
      "--append-system-prompt",
      "You are the primary agent.",
    ]),
  );
});

test("claude: advisor none and style default add nothing; blank agents and prompt add nothing", async () => {
  const { view, runs } = flyout("claude", CLAUDE, {
    model: "opus",
    effort: "low",
    agentsInput: input("  \n"),
    promptInput: input("   "),
  });
  await view.launch(cx);
  assert.deepEqual(
    argvOf(runs),
    withManagerEnvironment([...CLAUDE, "--model", "opus", "--effort", "low"]),
  );
});

test("claude: invalid agents JSON blocks the launch and names the line", async () => {
  const { view, runs } = flyout("claude", CLAUDE, { agentsInput: input('{\n  "a": \n}') });
  await view.launch(cx);
  assert.equal(argvOf(runs), undefined);
  assert.ok((view.editors.agents?.error?.line ?? 0) >= 1);
  assert.equal(view.launching, false);
});

test("codex: --disable per ticked flag in catalog order, then one -c per config.toml MCP server", async () => {
  const toml =
    '[mcp_servers.foo]\ncommand = "x"\n[mcp_servers."bar baz"]\ncommand = "y"\n[other]\nk = 1\n';
  const { view, runs } = flyout("codex", ["codex", "--no-daemon"], {
    model: "gpt-5.6-sol",
    effort: "high",
    codexOff: ["apps", "mcp", "plugins"],
    files: new Map([["/home/test/.codex/config.toml", toml]]),
  });
  await view.launch(cx);
  assert.deepEqual(
    argvOf(runs),
    withManagerEnvironment([
      "codex",
      "--no-daemon",
      "-m",
      "gpt-5.6-sol",
      "-c",
      "model_reasoning_effort=high",
      "--disable",
      "plugins",
      "--disable",
      "apps",
      "-c",
      "mcp_servers.foo.enabled=false",
      "-c",
      'mcp_servers."bar baz".enabled=false',
    ]),
  );
});

test("codex: nothing ticked adds nothing, and a missing config.toml disables no server", async () => {
  const { view, runs } = flyout("codex", ["codex"], {
    model: "gpt-5.6-sol",
    effort: "low",
    codexOff: ["mcp"],
  });
  await view.launch(cx);
  assert.deepEqual(
    argvOf(runs),
    withManagerEnvironment(["codex", "-m", "gpt-5.6-sol", "-c", "model_reasoning_effort=low"]),
  );
});

test("opencode: the model rides in the environment and the TUI runs its own server", async () => {
  const { view, runs, files } = flyout("opencode", ["opencode"], {
    model: "opencode/big-pickle",
    effort: "high",
  });
  await view.launch(cx);
  assert.deepEqual(
    argvOf(runs),
    withManagerEnvironment([
      "env",
      'OPENCODE_CONFIG_CONTENT={"model":"opencode/big-pickle"}',
      "opencode",
      "--standalone",
    ]),
  );
  await delay();
  assert.deepEqual(JSON.parse(files.get("/home/test/.local/state/opencode/model.json") ?? ""), {
    variant: { "opencode/big-pickle": "high" },
  });
});

test("pi: --model, --thinking, the ticked --no-* switches and the appended prompt, in spec order", async () => {
  const { view, runs } = flyout("pi", ["pi"], {
    model: "radius/balanced",
    effort: "high",
    promptInput: input("Be brief."),
  });
  view.values.off = ["session", "extensions"];
  await view.launch(cx);
  assert.deepEqual(
    argvOf(runs),
    withManagerEnvironment([
      "pi",
      "--model",
      "radius/balanced",
      "--thinking",
      "high",
      "--no-extensions",
      "--no-session",
      "--append-system-prompt",
      "Be brief.",
    ]),
  );
});

test("pi: the Default entry starts pi on its own model, with no model or thinking flag", async () => {
  const { view, runs } = flyout("pi", ["pi"], { model: "", effort: "", promptInput: input("") });
  await view.launch(cx);
  assert.deepEqual(argvOf(runs), withManagerEnvironment(["pi"]));
});

test("pi: a model that does not think gets no --thinking", async () => {
  const { view, runs } = flyout("pi", ["pi"], {
    model: "omlx/x",
    effort: "",
    promptInput: input(""),
  });
  await view.launch(cx);
  assert.deepEqual(argvOf(runs), withManagerEnvironment(["pi", "--model", "omlx/x"]));
});

test("pi: when the model list cannot be read, the Default entry is still there to launch", async () => {
  const { view } = flyout("pi", ["pi"]);
  installHost({ exec: async () => Promise.reject(new Error("not installed")) });
  assert.deepEqual(await view.listModels(), [
    { id: "", label: "Default", efforts: [], fallbackEffort: "" },
  ]);
  const codex = flyout("codex", ["codex"], {
    exec: async () => Promise.reject(new Error("not installed")),
  }).view;
  await assert.rejects(() => codex.listModels(), /not installed/);
});
