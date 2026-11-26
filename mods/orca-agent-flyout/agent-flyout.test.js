// Unit tests for the agent flyout specs (generated from orca-ui/shared/agent-flyout.js): the specs are plain
// data, every name they mention resolves, each agent's argv is what its launch used to be, and the
// model-list parsers read output captured from the real CLIs.
import test, { describe } from "node:test";
import assert from "node:assert/strict";
// Both mods load a local copy in production; apply the same contracts to each.
for (const target of ["./agent-flyout.js", "../orca-agent-settings/agent-flyout.js"]) {
const {
  DEFAULT_AGENTS_TEXT,
  DEFAULT_PROMPT,
  PI_THINKING,
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
} = await import(target);
describe(target, () => {

// Names the flyout resolves in code: hooks for lists, expansions and after-launch work.
const SOURCES = new Set(["claudeOutputStyles"]);
const EXPANSIONS = new Set(["codexMcp"]);
const AFTER = new Set(["opencodeVariant"]);
const TYPES = new Set(["model", "effort", "select", "checklist", "editor", "provider"]);

const FIXTURES = {
  "codex": {
    "models": [
      {
        "slug": "gpt-6.2-sol",
        "display_name": "GPT-6.2-Sol",
        "visibility": "list",
        "default_reasoning_level": "low",
        "supported_reasoning_levels": [
          {
            "effort": "low",
            "description": "Fast responses with lighter reasoning"
          },
          {
            "effort": "medium",
            "description": "Balances speed and reasoning depth for everyday tasks"
          },
          {
            "effort": "high",
            "description": "Greater reasoning depth for complex problems"
          },
          {
            "effort": "xhigh",
            "description": "Extra high reasoning depth for complex problems"
          },
          {
            "effort": "max",
            "description": "Maximum reasoning depth for the hardest problems"
          },
          {
            "effort": "ultra",
            "description": "Maximum reasoning with automatic task delegation"
          }
        ]
      },
      {
        "slug": "gpt-6.2-astra",
        "display_name": "GPT-6.2-Astra",
        "visibility": "list",
        "default_reasoning_level": "low",
        "supported_reasoning_levels": [
          {
            "effort": "low",
            "description": "Fast responses with lighter reasoning"
          },
          {
            "effort": "medium",
            "description": "Balances speed and reasoning depth for everyday tasks"
          },
          {
            "effort": "high",
            "description": "Greater reasoning depth for complex problems"
          },
          {
            "effort": "xhigh",
            "description": "Extra high reasoning depth for complex problems"
          },
          {
            "effort": "max",
            "description": "Maximum reasoning depth for the hardest problems"
          },
          {
            "effort": "ultra",
            "description": "Maximum reasoning with automatic task delegation"
          }
        ]
      },
      {
        "slug": "gpt-reserve",
        "display_name": "GPT-Reserve",
        "visibility": "hide",
        "default_reasoning_level": "medium",
        "supported_reasoning_levels": [
          {
            "effort": "low",
            "description": "Fast responses with lighter reasoning"
          },
          {
            "effort": "medium",
            "description": "Balances speed and reasoning depth for everyday tasks"
          },
          {
            "effort": "high",
            "description": "Greater reasoning depth for complex problems"
          },
          {
            "effort": "xhigh",
            "description": "Extra high reasoning depth for complex problems"
          },
          {
            "effort": "max",
            "description": "Maximum reasoning depth for the hardest problems"
          }
        ]
      }
    ]
  },
  "opencode": {
    "data": [
      {
        "id": "tidepool-alpha-free",
        "modelID": "tidepool-alpha-free",
        "providerID": "opencode",
        "name": "Tidepool Alpha Free",
        "cost": [
          {
            "input": 0,
            "output": 0,
            "cache": {
              "read": 0,
              "write": 0
            }
          }
        ],
        "variants": [
          {
            "id": "minimal",
            "settings": {
              "reasoningEffort": "minimal"
            }
          },
          {
            "id": "low",
            "settings": {
              "reasoningEffort": "low"
            }
          },
          {
            "id": "medium",
            "settings": {
              "reasoningEffort": "medium"
            }
          },
          {
            "id": "high",
            "settings": {
              "reasoningEffort": "high"
            }
          },
          {
            "id": "xhigh",
            "settings": {
              "reasoningEffort": "xhigh"
            }
          },
          {
            "id": "max",
            "settings": {
              "reasoningEffort": "max"
            }
          }
        ]
      },
      {
        "id": "gemini-4-neon",
        "modelID": "gemini-4-neon",
        "providerID": "opencode",
        "name": "Gemini 4 Neon",
        "cost": [
          {
            "input": 3,
            "output": 15,
            "cache": {
              "read": 0.15,
              "write": 0
            }
          }
        ],
        "variants": [
          {
            "id": "low",
            "settings": {
              "thinkingConfig": {
                "includeThoughts": true,
                "thinkingLevel": "low"
              }
            }
          },
          {
            "id": "medium",
            "settings": {
              "thinkingConfig": {
                "includeThoughts": true,
                "thinkingLevel": "medium"
              }
            }
          },
          {
            "id": "high",
            "settings": {
              "thinkingConfig": {
                "includeThoughts": true,
                "thinkingLevel": "high"
              }
            }
          },
          {
            "id": "xhigh",
            "settings": {
              "thinkingConfig": {
                "includeThoughts": true,
                "thinkingLevel": "xhigh"
              }
            }
          }
        ]
      },
      {
        "id": "AX-Clef-27B-MLX-AXQ-MXFP8",
        "modelID": "AX-Clef-27B-MLX-AXQ-MXFP8",
        "providerID": "omlx",
        "name": "AX-Clef-27B-MLX-AXQ-MXFP8",
        "cost": [],
        "variants": [
          {
            "id": "low",
            "settings": {
              "reasoningEffort": "low"
            }
          },
          {
            "id": "medium",
            "settings": {
              "reasoningEffort": "medium"
            }
          },
          {
            "id": "high",
            "settings": {
              "reasoningEffort": "high"
            }
          }
        ]
      },
      {
        "id": "qwen3-vl:4b",
        "modelID": "qwen3-vl:4b",
        "providerID": "ollama",
        "name": "qwen3-vl:4b",
        "cost": [],
        "variants": []
      }
    ]
  },
  "pi": "provider  model                                      context  max-out  thinking  images\nomlx      AX-Clef-27B-MLX-AXQ-MXFP8                  128K     16.4K    no        no    \nomlx      AX-Clef-Flash-9B-MLX-AXQ-MXFP8             128K     16.4K    no        no    \nradius    claude-fable-5                             1M       128K     yes       yes   \nradius    balanced                                   1.0M     262.1K   yes       yes   "
};

test("a spec is plain data: it survives JSON and names only what the flyout resolves", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(SPECS)), SPECS);
  for (const [key, spec] of Object.entries(SPECS)) {
    assert.ok(spec.command && spec.label && spec.models.shell, key);
    assert.ok(PARSERS[spec.models.parser], `${key}: parser ${spec.models.parser}`);
    for (const [id, option] of Object.entries(spec.options)) {
      assert.ok(TYPES.has(option.type), `${key}.${id}: type ${option.type}`);
      if (option.source) assert.ok(SOURCES.has(option.source), `${key}.${id}: source ${option.source}`);
      for (const item of option.items ?? []) if (item.expand) assert.ok(EXPANSIONS.has(item.expand), `${key}.${id}: ${item.expand}`);
    }
    for (const id of spec.launch) assert.ok(spec.options[id], `${key}: launch ${id}`);
    for (const section of sectionsOf(spec)) for (const id of section.options) assert.ok(spec.options[id], `${key}: section ${id}`);
    for (const row of spec.ui?.rows ?? []) for (const id of row) assert.ok(spec.options[id], `${key}: row ${id}`);
    if (spec.wrap?.after) assert.ok(AFTER.has(spec.wrap.after), key);
  }
});

test("hasFlyout is true for the agents with a spec only", () => {
  for (const key of ["claude", "codex", "opencode", "pi"]) assert.equal(hasFlyout(key), true, key);
  for (const key of ["gemini", "grok", "constructor", "__proto__", ""]) assert.equal(hasFlyout(key), false, key);
});

test("sections: Codex has its own, the others get ARGUMENTS and ADVANCED from their option types", () => {
  assert.deepEqual(sectionsOf(SPECS.codex).map((s) => s.title), ["MODEL SOURCE", "HARNESS CLI ARGUMENTS", "HARNESS CLI ADVANCED ARGUMENTS"]);
  assert.deepEqual(sectionsOf(SPECS.claude), [
    { title: "MODEL SOURCE", options: ["provider"], gap: 4 },
    { title: "HARNESS CLI ARGUMENTS", options: ["model", "effort"], gap: 4 },
    { title: "HARNESS CLI ADVANCED ARGUMENTS", options: ["advisorModel", "outputStyle", "agents", "systemPrompt"] },
  ]);
  assert.deepEqual(sectionsOf(SPECS.opencode), [
    { title: "MODEL SOURCE", options: ["provider"], gap: 4 },
    { title: "HARNESS CLI ARGUMENTS", options: ["model", "effort"], gap: 4 },
  ]);
});

test("claude argv: model and effort, then advisor, style, agents and prompt in launch order", () => {
  const base = ["claude", "--dangerously-skip-permissions"];
  const rest = { advisorModel: "none", outputStyle: "default", agents: "  ", systemPrompt: "" };
  assert.deepEqual(buildArgv(SPECS.claude, base, { model: "sonnet", effort: "high", ...rest }), [...base, "--model", "sonnet", "--effort", "high"]);
  assert.deepEqual(buildArgv(SPECS.claude, base, { model: "haiku", effort: "", ...rest }), [...base, "--model", "haiku"]);
  assert.deepEqual(
    buildArgv(SPECS.claude, base, { model: "opus", effort: "max", advisorModel: "opus", outputStyle: "eli5", agents: '{"a":1}', systemPrompt: "Be brief." }),
    [...base, "--model", "opus", "--effort", "max", "--advisor", "opus", "--settings", '{"outputStyle":"eli5"}', "--agents", '{"a":1}', "--append-system-prompt", "Be brief."],
  );
});

test("codex argv: -m, the effort config, then --disable per ticked flag in catalog order and the MCP expansion", () => {
  const base = ["codex", "--no-daemon"];
  const values = { model: "gpt-5.6-sol", effort: "high", codexOff: ["mcp", "apps", "plugins"] };
  assert.deepEqual(buildArgv(SPECS.codex, base, values, { expansions: { codexMcp: ["-c", "mcp_servers.foo.enabled=false"] } }), [
    "codex", "--no-daemon", "-m", "gpt-5.6-sol", "-c", "model_reasoning_effort=high", "--disable", "plugins", "--disable", "apps", "-c", "mcp_servers.foo.enabled=false",
  ]);
  assert.deepEqual(buildArgv(SPECS.codex, ["codex"], { model: "m", effort: null, codexOff: [] }), ["codex", "-m", "m"]);
  // A provider launch has its own model flag and no effort.
  assert.deepEqual(buildArgv(SPECS.codex, ["codex"], values, { skip: ["model", "effort"], expansions: { codexMcp: [] } }), ["codex", "--disable", "plugins", "--disable", "apps"]);
});

test("opencode argv: the model in the environment and the TUI on its own server", () => {
  assert.deepEqual(buildArgv(SPECS.opencode, ["opencode"], { model: "opencode/big-pickle", effort: "high" }), [
    "env", 'OPENCODE_CONFIG_CONTENT={"model":"opencode/big-pickle"}', "opencode", "--standalone",
  ]);
});

test("pi argv: --model, --thinking, the ticked --no-* switches, then the appended prompt", () => {
  assert.deepEqual(buildArgv(SPECS.pi, ["pi"], { model: "omlx/x", effort: "", off: ["session", "extensions"], systemPrompt: "" }), ["pi", "--model", "omlx/x", "--no-extensions", "--no-session"]);
  assert.deepEqual(
    buildArgv(SPECS.pi, ["pi"], { model: "radius/balanced", effort: "high", off: ["offline"], systemPrompt: "Be brief." }),
    ["pi", "--model", "radius/balanced", "--thinking", "high", "--offline", "--append-system-prompt", "Be brief."],
  );
});

test("an option with a blank value or an omitted choice adds nothing", () => {
  assert.deepEqual(optionArgs(SPECS.claude.options.advisorModel, "none"), []);
  assert.deepEqual(optionArgs(SPECS.claude.options.advisorModel, "haiku"), ["--advisor", "haiku"]);
  assert.deepEqual(optionArgs(SPECS.claude.options.systemPrompt, "   \n"), []);
  assert.deepEqual(optionArgs(SPECS.claude.options.outputStyle, "default"), []);
  assert.deepEqual(optionArgs(SPECS.codex.options.codexOff, undefined), []);
});

test("saved settings read back as values, with the old spellings", () => {
  const defaults = defaultValues(SPECS.claude);
  assert.equal(defaults.advisorModel, "opus");
  assert.equal(defaults.agents, DEFAULT_AGENTS_TEXT);
  assert.equal(defaults.systemPrompt, DEFAULT_PROMPT);
  // advisor: false was the old off switch
  assert.equal(readValues(SPECS.claude, { preset: { advisor: false, advisorModel: "opus" } }).advisorModel, "none");
  assert.equal(readValues(SPECS.claude, { preset: { advisorModel: "bogus" } }).advisorModel, "opus");
  assert.equal(readValues(SPECS.claude, { preset: { outputStyle: "eli5", systemPrompt: "x", agents: "{}" } }).outputStyle, "eli5");
  assert.deepEqual(readValues(SPECS.codex, { model: "m", effort: "low", preset: { codexOff: ["apps", "nope", "mcp"] } }), { model: "m", effort: "low", codexOff: ["apps", "mcp"] });
  assert.deepEqual(readValues(SPECS.codex, {}).codexOff, []);
});

test("the preset to save holds every non-top option under its own id, in today's keys", () => {
  const values = { ...defaultValues(SPECS.claude), model: "sonnet", effort: "high", outputStyle: "eli5" };
  assert.deepEqual(Object.keys(presetOf(SPECS.claude, values)).sort(), ["advisorModel", "agents", "outputStyle", "systemPrompt"]);
  assert.deepEqual(presetOf(SPECS.codex, { codexOff: ["apps"] }), { codexOff: ["apps"] });
  assert.deepEqual(presetOf(SPECS.opencode, {}), {});
});

test("an opencode group is the saved one, or all for the old unchecked 'only free'", () => {
  const option = SPECS.opencode.options.model;
  assert.equal(readGroup(option, {}), "free");
  assert.equal(readGroup(option, { group: "omlx" }), "omlx");
  assert.equal(readGroup(option, { group: "nope" }), "free");
  assert.equal(readGroup(option, { onlyFree: false }), "all");
});

test("codex catalog: visible models with their efforts", () => {
  const models = parseModels("codexCatalog", JSON.stringify(FIXTURES.codex));
  assert.equal(models.length, 2);
  assert.equal(models[0].id, "gpt-6.2-sol");
  assert.equal(models[0].label, "GPT-6.2-Sol");
  assert.ok(models[0].efforts.includes("low") && models[0].efforts.includes("max"));
  assert.equal(models[0].fallbackEffort, "low");
  // A notice before the JSON does not matter.
  assert.equal(parseModels("codexCatalog", `update available\n${JSON.stringify(FIXTURES.codex)}`).length, 2);
});

test("opencode catalog: opencode and omlx models, free or paid by cost, ollama left out", () => {
  const models = parseModels("opencodeCatalog", JSON.stringify(FIXTURES.opencode));
  assert.deepEqual(models.map((m) => [m.id, m.group, m.free]), [
    ["opencode/tidepool-alpha-free", "free", true],
    ["opencode/gemini-4-neon", "paid", false],
    ["omlx/AX-Clef-27B-MLX-AXQ-MXFP8", "omlx", false],
  ]);
});

test("pi table: provider/model ids, thinking models get the levels, others none", () => {
  const models = parseModels("piTable", FIXTURES.pi);
  assert.deepEqual(models.map((m) => m.id), ["omlx/AX-Clef-27B-MLX-AXQ-MXFP8", "omlx/AX-Clef-Flash-9B-MLX-AXQ-MXFP8", "radius/claude-fable-5", "radius/balanced"]);
  assert.deepEqual(models[0].efforts, []);
  assert.deepEqual(models[2].efforts, ["", ...PI_THINKING]);
  assert.equal(models[2].group, "radius");
  assert.equal(models[2].fallbackEffort, "");
  assert.deepEqual(parseModels("piTable", "nothing here\n"), []);
});

test("claude initialize: the models of the control response, and an error when there is none", () => {
  const line = JSON.stringify({ type: "control_response", response: { response: { models: [{ value: "sonnet", displayName: "Sonnet 5.5", supportedEffortLevels: ["low", "high"] }] } } });
  assert.deepEqual(parseModels("claudeInitialize", `noise\n${line}\n`), [{ id: "sonnet", label: "Sonnet 5.5", efforts: ["low", "high"], fallbackEffort: "high" }]);
  assert.throws(() => parseModels("claudeInitialize", "nothing"), /did not list/);
  assert.throws(() => parseModels("nope", ""), /no model parser/);
});
});
}
