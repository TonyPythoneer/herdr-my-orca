import { afterEach, beforeEach, test, vi } from "vite-plus/test";
import assert from "node:assert/strict";
import NewMenu from "../../../src/mods/orca-new-menu/main.js";
import type { AgentRow } from "../../../src/mods/orca-new-menu/rows.js";

type Job = (cx: unknown) => unknown;
type TestHost = typeof globalThis & {
  __herdrShared?: (key: string) => unknown;
  __herdrSetShared?: (key: string, value: unknown) => void;
  __herdrSpaces?: () => unknown[];
  __herdrReadTextFile?: (path: string) => Promise<string | null>;
  __herdrChecking?: () => boolean;
};
const globals = globalThis as TestHost;

const host = vi.hoisted(() => ({ known: [] as AgentRow[] }));
vi.mock("herdr", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  knownAgents: async () => host.known,
  keys: () => [],
}));

beforeEach(() => {
  globals.__herdrChecking = () => true;
  globals.__herdrSpaces = () => [];
  globals.__herdrReadTextFile = async () => null;
});

afterEach(() => {
  vi.restoreAllMocks();
  globals.__herdrShared = undefined;
  globals.__herdrSetShared = undefined;
});

function context() {
  const jobs: Job[] = [];
  const cx = {
    focus_handle: () => ({ focus() {} }),
    spawn: (job: Job) => {
      jobs.push(job);
    },
    notify() {},
    timer: { after: (_ms: number, fn: () => void) => fn() },
  };
  return { cx, jobs };
}

test("orca-new-menu falls back to Herdr after the manager inventory expires", async () => {
  const known: AgentRow = { key: "codex", installed: false, run: ["codex"] };
  const fresh: AgentRow = { key: "codex", installed: true, run: ["/custom/codex"] };
  const shared = new Map<string, unknown>([
    ["agent-manager.inventory", { at: 1000, agents: [fresh] }],
  ]);
  let now = 2000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  globals.__herdrShared = (key) => shared.get(key);
  globals.__herdrSetShared = (key, value) => {
    shared.set(key, value);
  };
  host.known = [known];

  const first = new NewMenu();
  const firstContext = context();
  first.init({}, firstContext.cx as never);
  for (const job of firstContext.jobs) await job(firstContext.cx);
  assert.deepEqual(first.currentState().agents, [
    { ...known, installed: true, run: ["/custom/codex"] },
  ]);

  now = 121000;
  assert.deepEqual(first.currentState().agents, [known]);

  const reopened = new NewMenu();
  const reopenedContext = context();
  reopened.init({}, reopenedContext.cx as never);
  assert.deepEqual(reopened.currentState().agents, [known]);
  for (const job of reopenedContext.jobs) await job(reopenedContext.cx);
  assert.deepEqual(reopened.currentState().agents, [known]);
});
