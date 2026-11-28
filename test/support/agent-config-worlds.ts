import type { AgentConfigWorld } from "./agent-config-runtime.js";

const NOW = Date.now();
const STALE = 1;
const CODEX_MODELS = [
  { id: "m1", label: "Model One", efforts: ["low", "high"], fallbackEffort: "high" },
  { id: "m2", label: "Model Two", efforts: [], fallbackEffort: "high" },
  { id: "m3", label: "Model Three", efforts: ["low", "medium", "high"], fallbackEffort: "medium" },
];
const GROUPED = [
  {
    id: "opencode/a",
    label: "A",
    group: "free",
    free: true,
    efforts: ["", "high"],
    fallbackEffort: "high",
  },
  { id: "opencode/b", label: "B", group: "paid", efforts: [], fallbackEffort: "high" },
  { id: "omlx/c", label: "C", group: "omlx", efforts: [], fallbackEffort: "high" },
];
const catalog = (key: string, models: unknown[], checkedAt = NOW, schema = 4) => ({
  catalog: { [key]: { models, checkedAt, schema, version: "v1" } },
});
const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
const record = (name: string, over: Record<string, unknown> = {}) => ({
  name,
  host: "http://127.0.0.1:8000/v1",
  apiKey: "k",
  githubOwner: "",
  iconPath: "",
  verifiedAt: "x",
  models: ["pm1", "pm2"],
  selectedModel: { codex: "pm2" },
  ...over,
});
const PROVIDERS = json({
  omlx: record("oMLX", { iconPath: "/home/omlx.png" }),
  outside: record("Elsewhere", { iconPath: "/x/y.png" }),
  plain: record("Plain"),
  bad: record("Bad", { host: "nope" }),
});
const CLAUDE_REPLY = JSON.stringify({
  type: "control_response",
  response: {
    response: {
      models: [
        { value: "opus", displayName: "Opus", supportedEffortLevels: ["low", "high"] },
        { value: "haiku", displayName: "Haiku" },
      ],
    },
  },
});
const CODEX_REPLY = JSON.stringify({
  models: [
    {
      slug: "g1",
      display_name: "G1",
      visibility: "list",
      supported_reasoning_levels: [{ effort: "low" }, { effort: "high" }],
      default_reasoning_level: "high",
    },
    { slug: "hide", visibility: "hide" },
  ],
});
const PI_TABLE =
  "provider  model        context  max-out  thinking  images\nacme      big-model    128k     8k       yes       no\nacme      small-model  8k       1k       no        no\n";

export const AGENT_CONFIG_WORLDS: Record<string, AgentConfigWorld> = {
  "codex, fresh cache, providers, saved choices": {
    key: "codex",
    argv: ["codex", "--no-daemon"],
    files: {
      "/home/agent-config.json": json({
        codex: {
          model: "m3",
          effort: "low",
          hidden: ["m1"],
          preset: { codexOff: ["apps", "mcp"] },
        },
        ...catalog("codex", CODEX_MODELS),
      }),
      "/home/model-providers.json": PROVIDERS,
      "/home/.codex/config.toml": '[mcp_servers.alpha]\n[mcp_servers."quoted name"]\n[other]\n',
      "/home/agent-manager.json": '{"disabled":["pi",4]}',
    },
  },
  "codex, fresh cache, launch now": {
    key: "codex",
    argv: ["codex"],
    launchNow: true,
    files: {
      "/home/agent-config.json": json({
        codex: { model: "gone" },
        ...catalog("codex", CODEX_MODELS),
      }),
      "/home/model-providers.json": PROVIDERS,
    },
  },
  "codex, launch now but disabled in the manager": {
    key: "codex",
    argv: ["codex"],
    launchNow: true,
    files: {
      "/home/agent-config.json": json(catalog("codex", CODEX_MODELS)),
      "/home/agent-manager.json": '{"disabled":["codex"]}',
    },
  },
  "codex, stale cache, list changed": {
    key: "codex",
    argv: ["codex"],
    files: {
      "/home/agent-config.json": json({
        codex: { model: "g1", effort: "high" },
        ...catalog("codex", CODEX_MODELS, STALE),
      }),
    },
    exec: { version: "codex 2.0", models: CODEX_REPLY },
  },
  "codex, stale cache, same list, version fails": {
    key: "codex",
    argv: ["codex"],
    files: {
      "/home/agent-config.json": json(
        catalog(
          "codex",
          [{ id: "g1", label: "G1", efforts: ["low", "high"], fallbackEffort: "high" }],
          STALE,
        ),
      ),
    },
    exec: { version: new Error("no cli"), models: CODEX_REPLY },
    launchNow: true,
  },
  "codex, stale cache, nothing listed": {
    key: "codex",
    argv: ["codex"],
    files: { "/home/agent-config.json": json(catalog("codex", CODEX_MODELS, STALE)) },
    exec: { version: "v", models: JSON.stringify({ models: [] }) },
  },
  "codex, old schema, cli fails": {
    key: "codex",
    argv: ["codex"],
    files: { "/home/agent-config.json": json(catalog("codex", CODEX_MODELS, NOW, 1)) },
    exec: { version: "v", models: new Error("offline") },
  },
  "codex, no settings file": {
    key: "codex",
    argv: ["codex"],
    files: {},
    exec: { version: "v", models: CODEX_REPLY },
  },
  "codex, settings not json": {
    key: "codex",
    argv: ["codex"],
    files: { "/home/agent-config.json": "{" },
    exec: { version: "v", models: CODEX_REPLY },
  },
  "codex, remote machine": {
    key: "codex",
    argv: ["codex"],
    machine: "m1",
    files: {
      "/home/agent-config.json": json(catalog("codex", CODEX_MODELS)),
      "/home/model-providers.json": PROVIDERS,
    },
  },
  "claude, styles and editors": {
    key: "claude",
    argv: ["claude"],
    dark: false,
    files: {
      "/home/agent-config.json": json({
        claude: {
          model: "haiku",
          effort: "high",
          preset: {
            outputStyle: "mine",
            advisorModel: "haiku",
            agents: "{bad",
            systemPrompt: "be brief",
          },
        },
        ...catalog("claude", [
          { id: "opus", label: "Opus", efforts: ["low", "high"], fallbackEffort: "high" },
          { id: "haiku", label: "Haiku", efforts: [], fallbackEffort: "high" },
        ]),
      }),
    },
    exec: { ls: "mine.md\nnotes.txt\nExplanatory.md\n" },
  },
  "claude, valid agents json": {
    key: "claude",
    argv: ["claude"],
    files: {
      "/home/agent-config.json": json({
        claude: { preset: { agents: '{"a":{"x":1}}' } },
        ...catalog("claude", [
          { id: "opus", label: "Opus", efforts: ["low"], fallbackEffort: "low" },
        ]),
      }),
    },
    exec: { ls: new Error("no dir") },
  },
  "claude, no cache": {
    key: "claude",
    argv: ["claude"],
    files: {},
    exec: { version: "1.0", models: CLAUDE_REPLY, ls: "" },
  },
  "opencode, groups, hidden models, variant file": {
    key: "opencode",
    argv: ["opencode"],
    files: {
      "/home/agent-config.json": json({
        opencode: { model: "opencode/a", effort: "high", group: "paid", hidden: ["opencode/b"] },
        ...catalog("opencode", GROUPED),
      }),
      "/home/.local/state/opencode/model.json": '{"variant":{"x":"y"}}',
    },
  },
  "opencode, all group, variant file missing": {
    key: "opencode",
    argv: ["opencode"],
    files: {
      "/home/agent-config.json": json({
        opencode: { onlyFree: false, model: "omlx/c", effort: "" },
        ...catalog("opencode", GROUPED),
      }),
    },
  },
  "pi, no cache": {
    key: "pi",
    argv: ["pi"],
    files: {},
    exec: { version: "pi 1", models: PI_TABLE },
  },
  "pi, no cache, cli lists nothing": {
    key: "pi",
    argv: ["pi"],
    files: {},
    exec: { version: "pi 1", models: new Error("none") },
  },
  "pi, saved presets": {
    key: "pi",
    argv: ["pi"],
    files: {
      "/home/agent-config.json": json({
        pi: {
          model: "acme/big-model",
          effort: "high",
          preset: { off: ["mcp"], systemPrompt: "x" },
        },
        ...catalog("pi", [
          { id: "", label: "Default", efforts: [], fallbackEffort: "" },
          {
            id: "acme/big-model",
            label: "big-model",
            group: "acme",
            efforts: ["", "high"],
            fallbackEffort: "",
          },
        ]),
      }),
    },
    exec: {},
  },
  "checking: no loading": { key: "codex", argv: ["codex"], files: {}, checking: true },
};
