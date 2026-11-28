import { describe, it } from "vite-plus/test";
import assert from "node:assert/strict";
import {
  buildPorts,
  knownSpaces,
  sections,
  type Port,
  type PortListener,
} from "../../src/shared/scan";

describe("scan source behavior", () => {
  it("attributes a pane folder only when the pane's tab belongs to the space, including an empty tab id", () => {
    const spaces = knownSpaces(
      [{ id: "s1", name: "Alpha", folder: "/work/alpha/", tabs: [{ id: "" }, { id: "t2" }] }],
      [
        { tab: "", cwd: "/work/alpha/api/" },
        { tab: "t2", cwd: "/work/alpha/web" },
        { tab: "t9", cwd: "/work/alpha/other" },
        { tab: "t2", cwd: "" },
        { tab: null, cwd: "/work/alpha/none" },
      ],
    );
    assert.deepEqual(spaces, [
      { id: "s1", name: "Alpha", folders: ["/work/alpha", "/work/alpha/api", "/work/alpha/web"] },
    ]);
  });

  it("reads the cwd of a listener with a null pid as absent, so it stays external", () => {
    const listeners: PortListener[] = [
      { pid: null, processName: null, bindHost: "*", connectHost: "localhost", port: 5173 },
    ];
    const cwds = new Map<number, string | null>([[1, "/work/alpha"]]);
    const known = [{ id: "s1", name: "Alpha", folders: ["/work/alpha"] }];
    const ports = buildPorts(listeners, cwds, known);
    assert.equal(ports[0]?.kind, "external");
    assert.equal(ports[0]?.owner, undefined);
    assert.equal(ports[0]?.id, "localhost:5173:unknown");
  });

  it("orders workspace groups by display name and then by their first port", () => {
    const workspacePort = (number: number, spaceId: string, displayName: string): Port => ({
      bindHost: "127.0.0.1",
      connectHost: "127.0.0.1",
      pid: number,
      processName: "node",
      port: number,
      id: `127.0.0.1:${number}:${number}`,
      protocol: "unknown",
      kind: "workspace",
      owner: { spaceId, displayName },
    });
    const view = sections([
      workspacePort(4000, "b", "Beta"),
      workspacePort(3000, "a", "Alpha"),
      workspacePort(3500, "b", "Beta"),
      workspacePort(5000, "c", "Alpha"),
    ]);
    assert.deepEqual(
      view.groups.map((group) => [group.spaceId, group.ports.map((p) => p.port)]),
      [
        ["a", [3000]],
        ["c", [5000]],
        ["b", [3500, 4000]],
      ],
    );
  });
});
