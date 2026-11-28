import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import {
  AGENT,
  AGENT_DEFINITIONS,
  AGENT_KEYS,
  OFFICIAL_AGENT_KEYS,
  isAgentKey,
} from "../../src/config/definitions/agent-catalog.js";
import { BUILTIN_DEFAULTS, HOMEPAGES } from "../../src/mods/orca-agent-settings/state.js";

const LEGACY_OFFICIAL_ORDER =
  "claude codex pi opencode cursor copilot amp gemini grok antigravity boldcreate crush dsh-tui empryo goose hermes kimi kiro omp pig qoder swival".split(
    " ",
  );

const LEGACY_DEFAULT_RUN: Record<string, string[]> = {
  claude: ["claude"],
  codex: ["codex", "--no-daemon"],
  pi: ["pi"],
  opencode: ["opencode"],
  cursor: ["agent"],
  copilot: ["copilot"],
  amp: ["amp"],
  gemini: ["gemini"],
  grok: ["grok"],
  antigravity: ["agy"],
  boldcreate: ["boldcreate"],
  empryo: ["empryo"],
  swival: ["swival"],
  crush: ["crush"],
  "dsh-tui": ["dsh-tui"],
  goose: ["goose"],
  hermes: ["hermes"],
  kimi: ["kimi"],
  kiro: ["kiro-cli"],
  omp: ["omp"],
  pig: ["pig"],
  qoder: ["qodercli"],
};

test("catalog keys match the legacy official list in order", () => {
  assert.deepEqual([...AGENT_KEYS], LEGACY_OFFICIAL_ORDER);
});

test("every key has the legacy default run argv", () => {
  for (const key of AGENT_KEYS) {
    assert.deepEqual([...AGENT_DEFINITIONS[key].defaultRun], LEGACY_DEFAULT_RUN[key], key);
  }
  assert.equal(Object.keys(LEGACY_DEFAULT_RUN).length, AGENT_KEYS.length);
});

test("official set holds exactly the catalog keys", () => {
  assert.equal(OFFICIAL_AGENT_KEYS.size, 22);
  for (const key of LEGACY_OFFICIAL_ORDER) assert.equal(OFFICIAL_AGENT_KEYS.has(key), true, key);
  for (const key of ["freebuff", "aider", "agy", "cursor-agent", ""]) {
    assert.equal(OFFICIAL_AGENT_KEYS.has(key), false, key);
  }
});

test("AGENT constants equal their own keys", () => {
  for (const key of AGENT_KEYS) assert.equal(AGENT[key], key);
});

test("isAgentKey accepts catalog keys and rejects everything else", () => {
  for (const key of AGENT_KEYS) assert.equal(isAgentKey(key), true, key);
  for (const value of [
    "freebuff",
    "aider",
    "agy",
    "toString",
    "__proto__",
    "",
    7,
    null,
    undefined,
  ]) {
    assert.equal(isAgentKey(value), false, String(value));
  }
});

test("homepages keep their legacy URLs", () => {
  assert.equal(AGENT_DEFINITIONS.claude.homepage, "https://code.claude.com/docs");
  assert.equal(AGENT_DEFINITIONS.codex.homepage, "https://github.com/openai/codex");
  assert.equal(AGENT_DEFINITIONS.qoder.homepage, "https://docs.qoder.com/cli/overview");
  assert.equal(
    AGENT_DEFINITIONS["dsh-tui"].homepage,
    "https://github.com/ccch1mneyyy/dsh-TUI#quick-start",
  );
});

test("catalog stays identical to the settings default and homepage tables", () => {
  assert.deepEqual([...Object.keys(BUILTIN_DEFAULTS)].sort(), [...AGENT_KEYS].sort());
  assert.deepEqual([...Object.keys(HOMEPAGES)].sort(), [...AGENT_KEYS].sort());
  for (const key of AGENT_KEYS) {
    assert.deepEqual([...AGENT_DEFINITIONS[key].defaultRun], BUILTIN_DEFAULTS[key], key);
    assert.equal(AGENT_DEFINITIONS[key].homepage, HOMEPAGES[key], key);
  }
});
