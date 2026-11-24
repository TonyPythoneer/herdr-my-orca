import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PANEL,
  addressForPort,
  attributeSpace,
  buildPorts,
  browserUrlForPort,
  dedupePorts,
  inferProtocol,
  knownSpaces,
  panelAt,
  panelHeight,
  parseAddressWithPort,
  parseCwds,
  parseListeners,
  sections,
} from "./scan.js";

// Real `lsof -O -nP -iTCP -sTCP:LISTEN -Fpcn` output, trimmed to the shapes it uses: two pids,
// a wildcard bind, a loopback bind, and the same socket listed twice (a forked server).
const LSOF = [
  "p1097",
  "cControlCenter",
  "n*:7000",
  "n*:7000",
  "n*:5000",
  "p2543",
  "collama",
  "n127.0.0.1:11434",
  "p56862",
  "cDeepAI Code Helper",
  "n[::1]:3773",
].join("\n");

test("parseListeners reads pid, process name and each socket", () => {
  const listeners = parseListeners(LSOF);
  assert.deepEqual(listeners, [
    { pid: 1097, processName: "ControlCenter", bindHost: "*", connectHost: "localhost", port: 7000 },
    { pid: 1097, processName: "ControlCenter", bindHost: "*", connectHost: "localhost", port: 7000 },
    { pid: 1097, processName: "ControlCenter", bindHost: "*", connectHost: "localhost", port: 5000 },
    { pid: 2543, processName: "ollama", bindHost: "127.0.0.1", connectHost: "127.0.0.1", port: 11434 },
    { pid: 56862, processName: "DeepAI Code Helper", bindHost: "::1", connectHost: "::1", port: 3773 },
  ]);
});

test("parseAddressWithPort keeps IPv4, splits bracketed IPv6, rejects junk", () => {
  assert.deepEqual(parseAddressWithPort("127.0.0.1:5000"), { host: "127.0.0.1", port: 5000 });
  assert.deepEqual(parseAddressWithPort("*:80"), { host: "*", port: 80 });
  assert.deepEqual(parseAddressWithPort("[::1]:3000"), { host: "::1", port: 3000 });
  assert.deepEqual(parseAddressWithPort("[fe80::1%lo0]:443"), { host: "fe80::1%lo0", port: 443 });
  assert.equal(parseAddressWithPort("nonsense"), null);
  assert.equal(parseAddressWithPort("127.0.0.1:0"), null);
  assert.equal(parseAddressWithPort("127.0.0.1:70000"), null);
});

test("parseCwds maps a pid to its folder", () => {
  const stdout = ["p981", "n/", "p2543", "n/Users/tonyyang/git/herdr-my-orca"].join("\n");
  const cwds = parseCwds(stdout);
  assert.equal(cwds.get(981), "/");
  assert.equal(cwds.get(2543), "/Users/tonyyang/git/herdr-my-orca");
});

test("dedupePorts keeps one row per address, port and pid", () => {
  const ports = dedupePorts(parseListeners(LSOF));
  // The forked server's second `*:7000` goes; the same port on another pid or host stays.
  assert.equal(ports.length, 4);
  assert.deepEqual(ports.map((port) => port.port), [7000, 5000, 11434, 3773]);
});

test("inferProtocol follows Orca's port numbers", () => {
  assert.equal(inferProtocol(443), "https");
  assert.equal(inferProtocol(8443), "https");
  assert.equal(inferProtocol(3000), "http");
  assert.equal(inferProtocol(50553), "unknown");
});

test("addresses copy and open as a browser does", () => {
  assert.equal(addressForPort({ connectHost: "127.0.0.1", port: 50553 }), "127.0.0.1:50553");
  assert.equal(addressForPort({ connectHost: "::1", port: 3000 }), "[::1]:3000");
  assert.equal(browserUrlForPort({ connectHost: "localhost", port: 443, protocol: "https" }), "https://localhost:443");
  assert.equal(browserUrlForPort({ connectHost: "localhost", port: 50553, protocol: "unknown" }), "http://localhost:50553");
});

test("knownSpaces collects each space's own folder and its panes' folders, local only", () => {
  const known = knownSpaces(
    [
      {
        id: "s1",
        name: "herdr-my-orca",
        folder: "/Users/tonyyang/git/herdr-my-orca/",
        machine: null,
        tabs: [{ id: "t1" }, { id: "t2" }],
      },
      { id: "s2", name: "remote", folder: "/home/x", machine: "mini", tabs: [{ id: "t9" }] },
    ],
    [
      { tab: "t1", cwd: "/Users/tonyyang/git/herdr-my-orca/mods" },
      { tab: "t2", cwd: "/Users/tonyyang/git/herdr-my-orca" },
      { tab: "t9", cwd: "/home/x/project" },
    ]
  );
  assert.deepEqual(known, [
    {
      id: "s1",
      name: "herdr-my-orca",
      folders: ["/Users/tonyyang/git/herdr-my-orca", "/Users/tonyyang/git/herdr-my-orca/mods"],
    },
  ]);
});

test("attributeSpace picks the deepest folder and never a sibling with the same prefix", () => {
  const known = [
    { id: "s1", name: "repo", folders: ["/Users/t/repo"] },
    { id: "s2", name: "worktree", folders: ["/Users/t/repo.worktrees/wt-a"] },
    { id: "s3", name: "sibling", folders: ["/Users/t/repository"] },
  ];
  assert.equal(attributeSpace("/Users/t/repo/apps/web", known), "s1");
  assert.equal(attributeSpace("/Users/t/repo.worktrees/wt-a/packages/api", known), "s2");
  assert.equal(attributeSpace("/Users/t/repository/x", known), "s3");
  assert.equal(attributeSpace("/tmp", known), null);
  assert.equal(attributeSpace(null, known), null);
});

test("buildPorts attaches a workspace owner by cwd and leaves the rest external", () => {
  const known = [{ id: "s1", name: "herdr-my-orca", folders: ["/Users/t/herdr-my-orca"] }];
  const listeners = [
    { pid: 10, processName: "codex", bindHost: "127.0.0.1", connectHost: "127.0.0.1", port: 50553 },
    { pid: 20, processName: "kiri", bindHost: "*", connectHost: "localhost", port: 80 },
    { pid: null, processName: null, bindHost: "*", connectHost: "localhost", port: 443 },
  ];
  const cwds = new Map([
    [10, "/Users/t/herdr-my-orca"],
    [20, "/Applications/Kiri.app"],
  ]);
  const ports = buildPorts(listeners, cwds, known);
  assert.deepEqual(
    ports.map((port) => [port.port, port.kind, port.owner?.displayName ?? null]),
    [
      [50553, "workspace", "herdr-my-orca"],
      [80, "external", null],
      [443, "external", null],
    ]
  );
  assert.equal(ports[0].id, "127.0.0.1:50553:10");
});

test("sections groups workspaces by space, orders by name, and sorts ports", () => {
  const known = [
    { id: "s2", name: "zebra", folders: ["/t/zebra"] },
    { id: "s1", name: "alpha", folders: ["/t/alpha"] },
  ];
  const listeners = [
    { pid: 1, processName: "node", bindHost: "127.0.0.1", connectHost: "127.0.0.1", port: 3001 },
    { pid: 2, processName: "vite", bindHost: "127.0.0.1", connectHost: "127.0.0.1", port: 3000 },
    { pid: 3, processName: "python3", bindHost: "*", connectHost: "localhost", port: 8000 },
    { pid: 4, processName: "kiri", bindHost: "*", connectHost: "localhost", port: 80 },
  ];
  const cwds = new Map([
    [1, "/t/alpha"],
    [2, "/t/zebra"],
    [3, "/t/alpha/sub"],
  ]);
  const view = sections(buildPorts(listeners, cwds, known));
  assert.deepEqual(view.groups.map((group) => group.displayName), ["alpha", "zebra"]);
  assert.deepEqual(view.groups.map((group) => group.ports.map((port) => port.port)), [[3001, 8000], [3000]]);
  assert.deepEqual(view.external.map((port) => port.port), [80]);
  assert.equal(view.workspaceCount, 3);
  assert.equal(view.externalCount, 1);
});

test("panelHeight counts the sections it was given and stops at the scroll cap", () => {
  // Nothing to show: the header, Orca's "No workspace ports detected" line, the External header.
  assert.equal(panelHeight(sections([]), false), PANEL.header + PANEL.empty + PANEL.group);
  const owned = (index, kind) => ({
    id: `p${index}`,
    port: index + 1,
    kind,
    connectHost: "localhost",
    processName: "x",
    protocol: "unknown",
    owner: { spaceId: "s1", displayName: "alpha" },
  });
  const view = sections([owned(0, "workspace"), ...Array.from({ length: 40 }, (_, index) => owned(index + 1, "external"))]);
  assert.equal(panelHeight(view, false), PANEL.header + PANEL.group + PANEL.row + PANEL.group);
  assert.equal(panelHeight(view, true), PANEL.header + PANEL.maxBody);
});

test("panelAt keeps the panel's bottom edge above the status bar", () => {
  assert.deepEqual(panelAt(1440, 900, 300), {
    x: 1440 - PANEL.width - PANEL.margin,
    y: 900 - PANEL.bar - PANEL.margin - 300,
  });
  // A panel taller than the window still starts below the top edge.
  assert.equal(panelAt(800, 400, 900).y, PANEL.margin);
});
