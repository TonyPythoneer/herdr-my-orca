export type AgentDefinition = {
  readonly defaultRun: readonly string[];
  readonly homepage: string;
};

export const AGENT_DEFINITIONS = {
  claude: { defaultRun: ["claude"], homepage: "https://code.claude.com/docs" },
  codex: { defaultRun: ["codex", "--no-daemon"], homepage: "https://github.com/openai/codex" },
  pi: { defaultRun: ["pi"], homepage: "https://pi.dev" },
  opencode: { defaultRun: ["opencode"], homepage: "https://opencode.ai/docs/cli/" },
  cursor: { defaultRun: ["agent"], homepage: "https://cursor.com/cli" },
  copilot: {
    defaultRun: ["copilot"],
    homepage: "https://docs.github.com/en/copilot/how-tos/set-up/install-copilot-cli",
  },
  amp: { defaultRun: ["amp"], homepage: "https://ampcode.com/manual#install" },
  gemini: { defaultRun: ["gemini"], homepage: "https://github.com/google-gemini/gemini-cli" },
  grok: { defaultRun: ["grok"], homepage: "https://x.ai/cli" },
  antigravity: {
    defaultRun: ["agy"],
    homepage: "https://antigravity.google/docs/cli-overview",
  },
  boldcreate: {
    defaultRun: ["boldcreate"],
    homepage: "https://docs.boldcreate.ai/cli/getting-started/installation",
  },
  crush: { defaultRun: ["crush"], homepage: "https://github.com/charmbracelet/crush" },
  "dsh-tui": {
    defaultRun: ["dsh-tui"],
    homepage: "https://github.com/ccch1mneyyy/dsh-TUI#quick-start",
  },
  empryo: { defaultRun: ["empryo"], homepage: "https://empryo.com/docs/installation" },
  goose: { defaultRun: ["goose"], homepage: "https://goose-docs.ai/docs/quickstart/" },
  hermes: { defaultRun: ["hermes"], homepage: "https://hermes-agent.nousresearch.com/docs/" },
  kimi: {
    defaultRun: ["kimi"],
    homepage: "https://www.kimi.com/code/docs/en/kimi-code-cli/getting-started.html",
  },
  kiro: { defaultRun: ["kiro-cli"], homepage: "https://kiro.dev/docs/cli/" },
  omp: { defaultRun: ["omp"], homepage: "https://omp.sh" },
  pig: { defaultRun: ["pig"], homepage: "https://www.pi-in-go.dev/install/" },
  qoder: { defaultRun: ["qodercli"], homepage: "https://docs.qoder.com/cli/overview" },
  swival: { defaultRun: ["swival"], homepage: "https://github.com/Swival/swival#quick-start" },
} as const satisfies Record<string, AgentDefinition>;

export type AgentKey = keyof typeof AGENT_DEFINITIONS;

export const AGENT_KEYS = Object.keys(AGENT_DEFINITIONS) as AgentKey[];

export const AGENT = {
  claude: "claude",
  codex: "codex",
  pi: "pi",
  opencode: "opencode",
  cursor: "cursor",
  copilot: "copilot",
  amp: "amp",
  gemini: "gemini",
  grok: "grok",
  antigravity: "antigravity",
  boldcreate: "boldcreate",
  crush: "crush",
  "dsh-tui": "dsh-tui",
  empryo: "empryo",
  goose: "goose",
  hermes: "hermes",
  kimi: "kimi",
  kiro: "kiro",
  omp: "omp",
  pig: "pig",
  qoder: "qoder",
  swival: "swival",
} as const satisfies { readonly [K in AgentKey]: K };

export const OFFICIAL_AGENT_KEYS: ReadonlySet<string> = new Set(AGENT_KEYS);

export const isAgentKey = (value: unknown): value is AgentKey =>
  typeof value === "string" && Object.hasOwn(AGENT_DEFINITIONS, value);
