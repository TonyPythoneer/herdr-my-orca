import { describe, it } from "vite-plus/test";
import assert from "node:assert/strict";
import {
  RAIL_ORDER_KEY,
  applyRailOrder,
  persistRailOrder,
  readRailOrder,
  swapOrderIds,
  type RailOrder,
} from "../../src/shared/rail-order";

type TestGlobal = typeof globalThis & {
  __herdrShared?: (key: string) => unknown;
  __herdrSetShared?: (key: string, value: unknown) => void;
};
const host = globalThis as TestGlobal;

const agents = ["freebuff", "claude", "codex"];
const providers = ["acme", "anthropic", "ollama"];

function sharedState(order: RailOrder | null) {
  return (key: string) => (key === RAIL_ORDER_KEY ? order : undefined);
}

describe("rail order", () => {
  it("swapOrderIds exchanges two present ids without mutating the input", () => {
    const order = [...agents];
    const swapped = swapOrderIds(order, "freebuff", "claude");
    assert.deepEqual(swapped, ["claude", "freebuff", "codex"]);
    assert.deepEqual(order, agents);
  });

  it("swapOrderIds is a no-op for equal or missing ids", () => {
    assert.deepEqual(swapOrderIds(agents, "claude", "claude"), agents);
    assert.deepEqual(swapOrderIds(agents, "claude", "nope"), agents);
    assert.deepEqual(swapOrderIds(agents, "nope", "yep"), agents);
  });

  it("applyRailOrder orders listed keys first and appends the rest in list order", () => {
    const rows = agents.map((key) => ({ key }));
    const ordered = applyRailOrder(rows, ["codex", "freebuff"], (row) => row.key);
    assert.deepEqual(ordered.map((row) => row.key), ["codex", "freebuff", "claude"]);
  });

  it("applyRailOrder ignores saved keys that are not in the list", () => {
    const rows = agents.map((key) => ({ key }));
    const ordered = applyRailOrder(rows, ["codex", "ghost", "freebuff"], (row) => row.key);
    assert.deepEqual(ordered.map((row) => row.key), ["codex", "freebuff", "claude"]);
  });

  it("applyRailOrder with an empty order returns the list unchanged", () => {
    const rows = agents.map((key) => ({ key }));
    assert.deepEqual(
      applyRailOrder(rows, [], (row) => row.key).map((row) => row.key),
      agents,
    );
  });

  it("applyRailOrder uses keyOf so provider ids match bare ids", () => {
    const rows = providers.map((id) => ({ id }));
    const ordered = applyRailOrder(rows, ["ollama", "acme"], (row) => row.id);
    assert.deepEqual(ordered.map((row) => row.id), ["ollama", "acme", "anthropic"]);
  });

  it("readRailOrder defaults to empty lists when nothing is saved", () => {
    host.__herdrShared = sharedState(null);
    try {
      assert.deepEqual(readRailOrder(), { unofficial: [], providers: [] });
    } finally {
      delete host.__herdrShared;
    }
  });

  it("readRailOrder returns the saved order", () => {
    host.__herdrShared = sharedState({
      unofficial: ["claude", "codex"],
      providers: ["ollama", "acme"],
    });
    try {
      assert.deepEqual(readRailOrder(), {
        unofficial: ["claude", "codex"],
        providers: ["ollama", "acme"],
      });
    } finally {
      delete host.__herdrShared;
    }
  });

  it("readRailOrder tolerates a malformed saved value", () => {
    host.__herdrShared = () => "not-an-object";
    try {
      assert.deepEqual(readRailOrder(), { unofficial: [], providers: [] });
    } finally {
      delete host.__herdrShared;
    }
  });

  it("persistRailOrder writes through setShared under the rail.order key", () => {
    const sent: [string, unknown][] = [];
    host.__herdrShared = sharedState(null);
    host.__herdrSetShared = (key, value) => sent.push([key, value]);
    try {
      persistRailOrder({ unofficial: ["b"], providers: ["d"] });
      assert.deepEqual(sent, [["rail.order", { unofficial: ["b"], providers: ["d"] }]]);
    } finally {
      delete host.__herdrShared;
      delete host.__herdrSetShared;
    }
  });
});
