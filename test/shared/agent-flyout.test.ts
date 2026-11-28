import { it as test } from "vite-plus/test";
import assert from "node:assert/strict";
import {
  DEFAULT_PROMPT,
  PARSERS,
  SPECS,
  buildArgv,
  defaultValues,
  hasFlyout,
  optionArgs,
  parseModels,
  presetOf,
  readGroup,
  readValues,
  sectionsOf,
} from "../../src/shared/agent-flyout.ts";

test("defaultValues: checklists start empty, selects and editors at their default, models and effort unset", () => {
  assert.deepEqual(defaultValues(SPECS.codex), { codexOff: [], fast: false });
  assert.deepEqual(defaultValues(SPECS.pi), { off: [], systemPrompt: "" });
  const claude = defaultValues(SPECS.claude);
  assert.deepEqual(Object.keys(claude), [
    "fast",
    "advisorModel",
    "outputStyle",
    "agents",
    "systemPrompt",
  ]);
  assert.equal(claude.advisorModel, "opus");
  assert.equal(claude.outputStyle, "default");
  assert.equal(claude.systemPrompt, DEFAULT_PROMPT);
});

test("readValues: model and effort come from the top of the record, strings only", () => {
  assert.deepEqual(readValues(SPECS.codex, { model: "m", effort: "low" }), {
    model: "m",
    effort: "low",
    codexOff: [],
    fast: false,
  });
  assert.deepEqual(readValues(SPECS.codex, { model: 5, effort: null }), {
    codexOff: [],
    fast: false,
  });
  assert.deepEqual(readValues(SPECS.codex, { preset: { model: "ignored", effort: "ignored" } }), {
    codexOff: [],
    fast: false,
  });
  assert.deepEqual(readValues(SPECS.codex), { codexOff: [], fast: false });
});

test("readValues: a checklist keeps known ids in the saved order and drops the rest", () => {
  assert.deepEqual(
    readValues(SPECS.codex, { preset: { codexOff: ["mcp", "apps", "nope", 7] } }).codexOff,
    ["mcp", "apps"],
  );
  assert.deepEqual(readValues(SPECS.codex, { preset: { codexOff: "apps" } }).codexOff, []);
  assert.deepEqual(readValues(SPECS.pi, { preset: { off: ["offline", "session", "x"] } }).off, [
    "offline",
    "session",
  ]);
});

test("readValues: a select keeps a listed choice or any string from a hooked list, else its default", () => {
  const advisor = (preset) => readValues(SPECS.claude, { preset }).advisorModel;
  assert.equal(advisor({ advisorModel: "haiku" }), "haiku");
  assert.equal(advisor({ advisorModel: "bogus" }), "opus");
  assert.equal(advisor({ advisorModel: 3 }), "opus");
  assert.equal(advisor({}), "opus");
  assert.equal(
    advisor({ advisor: false, advisorModel: "haiku" }),
    "none",
    "the old off switch wins",
  );
  assert.equal(advisor({ advisor: true, advisorModel: "haiku" }), "haiku");
  const style = (preset) => readValues(SPECS.claude, { preset }).outputStyle;
  assert.equal(style({ outputStyle: "anything" }), "anything");
  assert.equal(style({ outputStyle: 4 }), "default");
  assert.equal(style({}), "default");
});

test("readValues: the old off switch only touches the advisor", () => {
  assert.equal(readValues(SPECS.claude, { preset: { advisor: false } }).outputStyle, "default");
  assert.equal(readValues(SPECS.codex, { preset: { advisor: false } }).advisorModel, undefined);
});

test("readValues: an editor keeps a saved string, even an empty one", () => {
  const values = readValues(SPECS.claude, { preset: { systemPrompt: "", agents: "{}" } });
  assert.equal(values.systemPrompt, "");
  assert.equal(values.agents, "{}");
  const bad = readValues(SPECS.claude, { preset: { systemPrompt: 5, agents: null } });
  assert.equal(bad.systemPrompt, DEFAULT_PROMPT);
  assert.match(bad.agents, /scout/);
});

test("opencodeCatalog: omlx models, free models (every tier costs nothing) and paid models are grouped", () => {
  const model = (extra) => ({ providerID: "opencode", modelID: "m", ...extra });
  const group = (extra) =>
    parseModels("opencodeCatalog", JSON.stringify({ data: [model(extra)] }))[0].group;
  assert.equal(group({ providerID: "omlx" }), "omlx");
  assert.equal(
    group({ providerID: "omlx", cost: [{ input: 5 }] }),
    "omlx",
    "local models are never paid",
  );
  assert.equal(group({ cost: [{ input: 0, output: 0 }, {}] }), "free");
  assert.equal(group({ cost: [{ input: 0, output: 1 }] }), "paid");
  assert.equal(group({ cost: [{ input: 1 }] }), "paid");
  assert.equal(group({ cost: [] }), "paid", "no cost list is not proof of free");
  assert.equal(group({}), "paid");
  const parsed = parseModels(
    "opencodeCatalog",
    JSON.stringify({
      data: [
        model({ cost: [{}], variants: [{ id: "high" }] }),
        { providerID: "other", modelID: "x" },
      ],
    }),
  );
  assert.deepEqual(parsed, [
    {
      id: "opencode/m",
      label: "m",
      group: "free",
      efforts: ["", "high"],
      fallbackEffort: "high",
      free: true,
    },
  ]);
});

test("spec lookup and generated sections preserve explicit and inferred layouts", () => {
  assert.equal(hasFlyout("claude"), true);
  assert.equal(hasFlyout("unknown"), false);
  assert.deepEqual(sectionsOf(SPECS.pi), SPECS.pi.ui.sections);
  assert.deepEqual(
    sectionsOf({
      label: "Custom",
      command: "custom",
      models: { shell: "custom models", parser: "custom" },
      launch: [],
      options: {
        model: { type: "model", label: "Model" },
        effort: { type: "effort", label: "Effort" },
        notes: { type: "editor", label: "Notes" },
      },
    }),
    [
      { title: "HARNESS CLI ARGUMENTS", options: ["model", "effort"], gap: 4 },
      { title: "HARNESS CLI ADVANCED ARGUMENTS", options: ["notes"] },
    ],
  );
  assert.deepEqual(
    sectionsOf({
      label: "Minimal",
      command: "minimal",
      models: { shell: "minimal models", parser: "minimal" },
      launch: [],
      options: { notes: { type: "editor", label: "Notes" } },
    }),
    [
      { title: "HARNESS CLI ARGUMENTS", options: [], gap: 4 },
      { title: "HARNESS CLI ADVANCED ARGUMENTS", options: ["notes"] },
    ],
  );
});

test("option arguments handle toggles, omitted values, checklist expansions and nested templates", () => {
  assert.deepEqual(optionArgs(SPECS.claude.options.fast, false), []);
  assert.deepEqual(optionArgs(SPECS.claude.options.fast, true), ["--fast-mode"]);
  assert.deepEqual(optionArgs(SPECS.claude.options.effort, "  "), []);
  assert.deepEqual(optionArgs(SPECS.claude.options.effort, ""), []);
  assert.deepEqual(optionArgs(SPECS.claude.options.advisorModel, "none"), []);
  assert.deepEqual(optionArgs(SPECS.codex.options.effort, ""), []);
  assert.deepEqual(optionArgs(SPECS.codex.options.effort, "high"), [
    "-c",
    "model_reasoning_effort=high",
  ]);
  assert.deepEqual(optionArgs(SPECS.claude.options.outputStyle, "compact"), [
    "--settings",
    '{"outputStyle":"compact"}',
  ]);
  assert.deepEqual(
    optionArgs(SPECS.codex.options.codexOff, ["mcp", "apps"], {
      codexMcp: ["--disable", "mcp-server"],
    }),
    ["--disable", "apps", "--disable", "mcp-server"],
  );
  assert.deepEqual(optionArgs(SPECS.codex.options.codexOff, ["unknown"]), []);
  assert.throws(
    () => optionArgs({ type: "editor", label: "Invalid", argv: [{ invalid: true }] }, "value"),
    /argument templates must produce strings/,
  );
});

test("buildArgv applies launch order, skips selected options and wraps OpenCode settings", () => {
  assert.deepEqual(
    buildArgv(
      SPECS.codex,
      ["codex", "--full-auto"],
      { model: "m", effort: "high", fast: true },
      { skip: ["fast"] },
    ),
    ["codex", "--full-auto", "-m", "m", "-c", "model_reasoning_effort=high"],
  );
  assert.deepEqual(
    buildArgv(SPECS.opencode, ["opencode", "run"], { model: "omlx/model", effort: "high" }),
    ["env", 'OPENCODE_CONFIG_CONTENT={"model":"omlx/model"}', "opencode", "run", "--standalone"],
  );
  assert.deepEqual(
    presetOf(SPECS.codex, { model: "m", effort: "high", fast: true, codexOff: ["apps"] }),
    { fast: true, codexOff: ["apps"] },
  );
  const checklist = ["apps"];
  const saved = presetOf(SPECS.codex, { codexOff: checklist });
  checklist.push("mcp");
  assert.deepEqual(saved.codexOff, ["apps"]);
});

test("OpenCode model groups honor saved groups and migrated free-only preferences", () => {
  const option = SPECS.opencode.options.model;
  assert.equal(readGroup(option, { group: "paid" }), "paid");
  assert.equal(readGroup(option, { group: "unknown" }), "free");
  assert.equal(readGroup(option, { onlyFree: false }), "all");
  assert.equal(readGroup({ type: "model", label: "Model" }), undefined);
});

test("model catalog parsers accept real CLI shapes and report malformed Claude and JSON output", () => {
  const claude = JSON.stringify({
    type: "control_response",
    response: {
      response: {
        models: [
          {
            value: "sonnet",
            displayName: "Claude Sonnet",
            supportedEffortLevels: ["low", 1, "high"],
            supportsFastMode: true,
          },
          { value: "haiku", displayName: "Claude Haiku" },
        ],
      },
    },
  });
  assert.deepEqual(parseModels("claudeInitialize", `noise\nnot json\n${claude}`), [
    {
      id: "sonnet",
      label: "Claude Sonnet",
      efforts: ["low", "high"],
      fallbackEffort: "high",
      fast: true,
    },
    { id: "haiku", label: "Claude Haiku", efforts: [], fallbackEffort: "high", fast: false },
  ]);
  assert.throws(
    () => parseModels("claudeInitialize", "{}\nnot json"),
    /claude did not list its models/,
  );
  assert.throws(() => parseModels("codexCatalog", "no model object"), SyntaxError);
  assert.throws(() => parseModels("missing", "{}"), /no model parser named missing/);
  assert.deepEqual(
    parseModels(
      "codexCatalog",
      JSON.stringify({
        models: [
          {
            slug: "listed",
            display_name: "Listed",
            visibility: "list",
            supported_reasoning_levels: [{ effort: "high" }, {}],
            service_tiers: [{ id: "priority" }],
          },
          { slug: "hidden", visibility: "hide" },
          null,
        ],
      }),
    ),
    [
      {
        id: "listed",
        label: "Listed",
        efforts: ["high", ""],
        fallbackEffort: undefined,
        fast: true,
      },
    ],
  );
  assert.deepEqual(
    parseModels(
      "opencodeCatalog",
      JSON.stringify({
        data: [
          { providerID: "other", modelID: "ignored" },
          { providerID: "opencode", modelID: "default", variants: [] },
        ],
      }),
    ),
    [
      {
        id: "opencode/default",
        label: "default",
        group: "paid",
        efforts: [],
        fallbackEffort: "high",
        free: false,
      },
    ],
  );
  assert.deepEqual(parseModels("piTable", "no provider table"), []);
  assert.deepEqual(
    parseModels(
      "piTable",
      "provider model    context thinking images\nopenai   gpt-5    128k     yes      yes\nlocal    llama    32k      no       no",
    ),
    [
      {
        id: "openai/gpt-5",
        label: "gpt-5",
        group: "openai",
        efforts: ["", "off", "minimal", "low", "medium", "high", "xhigh", "max"],
        fallbackEffort: "",
      },
      { id: "local/llama", label: "llama", group: "local", efforts: [], fallbackEffort: "" },
    ],
  );
  assert.deepEqual(
    PARSERS.piTable("provider model context thinking\nlocal    model  8k      yes"),
    [
      {
        id: "local/model",
        label: "model",
        group: "local",
        efforts: ["", "off", "minimal", "low", "medium", "high", "xhigh", "max"],
        fallbackEffort: "",
      },
    ],
  );
});

test("piTable parser: skips rows with empty provider or model", () => {
  const result = PARSERS.piTable(
    "provider model context thinking\n   \nopenai   gpt-5    128k     yes",
  );
  assert.deepEqual(result, [
    {
      id: "openai/gpt-5",
      label: "gpt-5",
      group: "openai",
      efforts: ["", "off", "minimal", "low", "medium", "high", "xhigh", "max"],
      fallbackEffort: "",
    },
  ]);
});

test("jsonObject rejects non-object JSON payloads", () => {
  assert.throws(
    () =>
      parseModels("opencodeCatalog", JSON.stringify([{ providerID: "opencode", modelID: "m" }])),
    TypeError,
  );
  assert.throws(() => parseModels("opencodeCatalog", '"just a string"'), TypeError);
  assert.throws(() => parseModels("opencodeCatalog", "42"), TypeError);
});
