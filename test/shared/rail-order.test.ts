import { describe, it } from "vite-plus/test";
import assert from "node:assert/strict";
import {
  RAIL_ORDER_KEY,
  applyRailOrder,
  dragSlot,
  moveInOrder,
  persistRailOrder,
  readRailOrder,
  type RailOrder,
} from "../../src/services/agent-settings/sidebar-order";

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
  it("moveInOrder moves a key to the target slot without mutating the input", () => {
    const order = [...agents];
    assert.deepEqual(moveInOrder(order, "codex", 0), ["codex", "freebuff", "claude"]);
    assert.deepEqual(moveInOrder(order, "freebuff", 2), ["claude", "codex", "freebuff"]);
    assert.deepEqual(order, agents);
  });

  it("moveInOrder clamps the target and ignores a missing key", () => {
    assert.deepEqual(moveInOrder(agents, "claude", 99), ["freebuff", "codex", "claude"]);
    assert.deepEqual(moveInOrder(agents, "claude", -5), ["claude", "freebuff", "codex"]);
    assert.deepEqual(moveInOrder(agents, "nope", 0), agents);
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

describe("dragSlot", () => {
  it("picks the row under the pointer, measured from the grab point", () => {
    // Rows are 60px. Grabbed 20px into row 0, the icon's top is pointer - 20.
    assert.equal(dragSlot(10, 20, 60, 3), 0);
    assert.equal(dragSlot(70, 20, 60, 3), 1);
    assert.equal(dragSlot(130, 20, 60, 3), 2);
  });

  it("clamps to the first and last row", () => {
    assert.equal(dragSlot(-200, 0, 60, 3), 0);
    assert.equal(dragSlot(900, 0, 60, 3), 2);
  });
});
