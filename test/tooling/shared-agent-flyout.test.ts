import { it } from "vite-plus/test";
import assert from "node:assert/strict";

type AgentApi = typeof import("../../src/shared/agent-flyout.ts");

const api: AgentApi = await import("../../src/shared/agent-flyout.ts");

it("canonical agent settings preserve saved values, launch arguments and model catalog edge cases", () => {
  const {
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
  } = api;
  assert.equal(hasFlyout("codex"), true);
  assert.equal(hasFlyout("typo"), false);
  assert.deepEqual(sectionsOf(SPECS.codex), SPECS.codex.ui.sections);
  assert.deepEqual(
    sectionsOf({
      options: { model: { type: "model" }, effort: { type: "effort" }, fast: { type: "toggle" } },
    } as never),
    [
      { title: "HARNESS CLI ARGUMENTS", options: ["model", "effort"], gap: 4 },
      { title: "HARNESS CLI ADVANCED ARGUMENTS", options: ["fast"] },
    ],
  );

  const defaults = defaultValues(SPECS.pi);
  assert.deepEqual(defaults, { off: [], systemPrompt: "" });
  const values = readValues(SPECS.pi, {
    model: "m",
    effort: "high",
    preset: { off: ["offline", "unknown"], systemPrompt: "" },
  });
  assert.deepEqual(values, { model: "m", effort: "high", off: ["offline"], systemPrompt: "" });
  assert.equal(
    readValues(SPECS.claude, { preset: { systemPrompt: 5 } }).systemPrompt,
    DEFAULT_PROMPT,
  );
  const codexValues = readValues(SPECS.codex, { preset: { codexOff: ["apps", "mcp"] } });
  const saved = presetOf(SPECS.codex, codexValues);
  assert.deepEqual(saved.codexOff, ["apps", "mcp"]);
  (saved.codexOff as string[]).push("changed");
  assert.deepEqual(codexValues.codexOff, ["apps", "mcp"]);
  assert.equal(readGroup(SPECS.opencode.options.model, { group: "paid" }), "paid");
  assert.equal(readGroup(SPECS.opencode.options.model, { onlyFree: false }), "all");
  assert.equal(readGroup(SPECS.opencode.options.model, {}), "free");

  assert.deepEqual(
    optionArgs(SPECS.codex.options.codexOff, ["apps", "mcp"], {
      codexMcp: ["-c", "mcp_servers.x.enabled=false"],
    }),
    ["--disable", "apps", "-c", "mcp_servers.x.enabled=false"],
  );
  assert.deepEqual(optionArgs(SPECS.claude.options.fast, true), ["--fast-mode"]);
  assert.deepEqual(optionArgs(SPECS.claude.options.fast, false), []);
  assert.deepEqual(optionArgs(SPECS.claude.options.advisorModel, "none"), []);
  assert.deepEqual(optionArgs(SPECS.claude.options.agents, '  {"a":1}  '), [
    "--agents",
    '  {"a":1}  ',
  ]);
  assert.deepEqual(optionArgs({ type: "select", argv: ["--x", { json: { model: "{v}" } }] }, "m"), [
    "--x",
    '{"model":"m"}',
  ]);
  const argv = buildArgv(
    SPECS.codex,
    ["codex"],
    { model: "m", effort: "high", fast: true, codexOff: ["apps", "mcp"] },
    { expansions: { codexMcp: ["-c", "mcp_servers.x.enabled=false"] } },
  );
  assert.ok(argv.includes("mcp_servers.x.enabled=false"));
  assert.equal(argv.includes("--provider"), false);
  assert.deepEqual(buildArgv(SPECS.opencode, ["opencode"], { model: "herdr/m" }), [
    "env",
    'OPENCODE_CONFIG_CONTENT={"model":"herdr/m"}',
    "opencode",
    "--standalone",
  ]);

  const claude = parseModels(
    "claudeInitialize",
    `noise\n${JSON.stringify({ type: "control_response", response: { response: { models: [{ value: "m", displayName: "M", supportedEffortLevels: ["high"], supportsFastMode: true }] } } })}`,
  );
  assert.deepEqual(claude, [
    { id: "m", label: "M", efforts: ["high"], fallbackEffort: "high", fast: true },
  ]);
  assert.throws(() => parseModels("claudeInitialize", "noise"), /did not list its models/);
  assert.deepEqual(
    parseModels(
      "codexCatalog",
      `header\n${JSON.stringify({
        models: [
          {
            slug: "m",
            display_name: "M",
            visibility: "list",
            supported_reasoning_levels: [{ effort: "high" }],
            service_tiers: [{ id: "priority" }],
          },
          { slug: "hidden", visibility: "hide", supported_reasoning_levels: [] },
        ],
      })}\nfooter`,
    ),
    [{ id: "m", label: "M", efforts: ["high"], fallbackEffort: undefined, fast: true }],
  );
  assert.deepEqual(
    parseModels(
      "opencodeCatalog",
      JSON.stringify({
        data: [
          { providerID: "omlx", modelID: "m", cost: [{ input: 1 }] },
          {
            providerID: "opencode",
            modelID: "free",
            cost: [{ input: 0, output: 0 }],
            variants: [{ id: "high" }],
          },
          { providerID: "other", modelID: "hidden" },
        ],
      }),
    ),
    [
      { id: "omlx/m", label: "m", group: "omlx", efforts: [], fallbackEffort: "high", free: false },
      {
        id: "opencode/free",
        label: "free",
        group: "free",
        efforts: ["", "high"],
        fallbackEffort: "high",
        free: true,
      },
    ],
  );
  const table =
    "provider    model          context max-out thinking images\nopenai      model name     8192    2048    yes      no\n";
  assert.deepEqual(PARSERS.piTable(table), [
    {
      id: "openai/model name",
      label: "model name",
      group: "openai",
      efforts: ["", ...api.PI_THINKING],
      fallbackEffort: "",
    },
  ]);
  assert.deepEqual(parseModels("piTable", "no catalog yet"), []);
  assert.throws(() => parseModels("missing", "{}"), /no model parser named/);
});
