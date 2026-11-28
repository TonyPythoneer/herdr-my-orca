import { it } from "vite-plus/test";
import assert from "node:assert/strict";
import {
  crewOf,
  crewMembers,
  crewGroups,
  crewSignature,
  STATUS_ORDER,
  type TerminalInfo,
} from "../../../src/mods/orca-pane-header/crew.js";

const term = (
  address: string,
  status: string | null,
  extra: Partial<TerminalInfo> = {},
): TerminalInfo => ({
  address,
  status,
  state: "live",
  report: { app: "omp" },
  program: { name: "omp" },
  ...extra,
});

const all: TerminalInfo[] = [
  term("t1", "idle"),
  term("t2", "working", { parent: "t1" }),
  term("t3", "blocked", { parent: "t1" }),
  term("t4", null, { parent: "t1" }),
  term("t5", "working", { parent: "t1", state: "finished" }),
  term("t9", "done"),
  term("w1", "working", { parent: "w0" }),
  term("w0", "idle"),
];

it("crewOf collects live children with a status, and nothing else", () => {
  const crew = crewOf(all, "t1");
  assert.deepEqual(
    crew.managing.map((t) => t.address),
    ["t2", "t3"],
  );
  assert.equal(crew.managedBy, null);
});

it("crewOf names the parent when the pane's own terminal is a child", () => {
  const crew = crewOf(all, "w1");
  assert.deepEqual(crew.managing, []);
  assert.equal(crew.managedBy?.address, "w0");
});

it("crewOf with no terminal address is empty", () => {
  assert.deepEqual(crewOf(all, null), { managing: [], managedBy: null });
});

it("crewMembers dedupes and puts managing first", () => {
  const crew = crewOf(all, "t1");
  assert.deepEqual(
    crewMembers(crew).map((t) => t.address),
    ["t2", "t3"],
  );
  const worker = crewOf(all, "w1");
  assert.deepEqual(
    crewMembers(worker).map((t) => t.address),
    ["w0"],
  );
});

it("crewGroups follows STATUS_ORDER and drops empty groups", () => {
  const crew = crewOf(all, "t1");
  assert.deepEqual(
    crewGroups(crew).map((g) => g.status),
    ["blocked", "working"],
  );
  assert.equal(STATUS_ORDER.join(","), "blocked,working,done,idle");
});

it("crewSignature changes when a member's status changes", () => {
  const before = crewSignature(crewOf(all, "t1"));
  const after = crewSignature(
    crewOf(
      all.map((t) => (t.address === "t2" ? term("t2", "done", { parent: "t1" }) : t)),
      "t1",
    ),
  );
  assert.notEqual(before, after);
});
