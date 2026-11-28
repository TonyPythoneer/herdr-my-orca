import { it } from "vite-plus/test";
import assert from "node:assert/strict";
import {
  PANEL,
  type Port,
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
} from "../../src/shared/scan";

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

it("parseListeners reads pid, process name and each socket", () => {
  const listeners = parseListeners(LSOF);
  assert.deepEqual(listeners, [
    {
      pid: 1097,
      processName: "ControlCenter",
      bindHost: "*",
      connectHost: "localhost",
      port: 7000,
    },
    {
      pid: 1097,
      processName: "ControlCenter",
      bindHost: "*",
      connectHost: "localhost",
      port: 7000,
    },
    {
      pid: 1097,
      processName: "ControlCenter",
      bindHost: "*",
      connectHost: "localhost",
      port: 5000,
    },
    {
      pid: 2543,
      processName: "ollama",
      bindHost: "127.0.0.1",
      connectHost: "127.0.0.1",
      port: 11434,
    },
    {
      pid: 56862,
      processName: "DeepAI Code Helper",
      bindHost: "::1",
      connectHost: "::1",
      port: 3773,
    },
  ]);
});

it("parseAddressWithPort keeps IPv4, splits bracketed IPv6, rejects junk", () => {
  assert.deepEqual(parseAddressWithPort("127.0.0.1:5000"), { host: "127.0.0.1", port: 5000 });
  assert.deepEqual(parseAddressWithPort("*:80"), { host: "*", port: 80 });
  assert.deepEqual(parseAddressWithPort("[::1]:3000"), { host: "::1", port: 3000 });
  assert.deepEqual(parseAddressWithPort("[fe80::1%lo0]:443"), { host: "fe80::1%lo0", port: 443 });
  assert.equal(parseAddressWithPort("nonsense"), null);
  assert.equal(parseAddressWithPort("127.0.0.1:0"), null);
  assert.equal(parseAddressWithPort("127.0.0.1:70000"), null);
});

it("parseCwds maps a pid to its folder", () => {
  const stdout = ["p981", "n/", "p2543", "n/Users/tonyyang/git/herdr-my-orca"].join("\n");
  const cwds = parseCwds(stdout);
  assert.equal(cwds.get(981), "/");
  assert.equal(cwds.get(2543), "/Users/tonyyang/git/herdr-my-orca");
});

it("parseCwds: n line with empty path after pid sets null", () => {
  const stdout = ["p981", "n"].join("\n");
  const cwds = parseCwds(stdout);
  assert.equal(cwds.get(981), null);
});

it("dedupePorts skips duplicate address:port:pid combinations", () => {
  const ports = dedupePorts([
    { pid: 10, processName: "a", bindHost: "127.0.0.1", connectHost: "127.0.0.1", port: 50553 },
    { pid: 10, processName: "a", bindHost: "127.0.0.1", connectHost: "127.0.0.1", port: 50553 },
    { pid: 10, processName: "a", bindHost: "127.0.0.1", connectHost: "127.0.0.1", port: 50554 },
  ]);
  assert.equal(ports.length, 2);
});

it("dedupePorts keeps one row per address, port and pid", () => {
  const ports = dedupePorts(parseListeners(LSOF));

  assert.equal(ports.length, 4);
  assert.deepEqual(
    ports.map((port) => port.port),
    [7000, 5000, 11434, 3773],
  );
});

it("inferProtocol follows Orca's port numbers", () => {
  assert.equal(inferProtocol(443), "https");
  assert.equal(inferProtocol(8443), "https");
  assert.equal(inferProtocol(3000), "http");
  assert.equal(inferProtocol(50553), "unknown");
});

it("addresses copy and open as a browser does", () => {
  assert.equal(addressForPort({ connectHost: "127.0.0.1", port: 50553 }), "127.0.0.1:50553");
  assert.equal(addressForPort({ connectHost: "::1", port: 3000 }), "[::1]:3000");
  assert.equal(
    browserUrlForPort({ connectHost: "localhost", port: 443, protocol: "https" }),
    "https://localhost:443",
  );
  assert.equal(
    browserUrlForPort({ connectHost: "localhost", port: 50553, protocol: "unknown" }),
    "http://localhost:50553",
  );
});

it("knownSpaces collects each space's own folder and its panes' folders, local only", () => {
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
    ],
  );
  assert.deepEqual(known, [
    {
      id: "s1",
      name: "herdr-my-orca",
      folders: ["/Users/tonyyang/git/herdr-my-orca", "/Users/tonyyang/git/herdr-my-orca/mods"],
    },
  ]);
});

it("attributeSpace picks the deepest folder and never a sibling with the same prefix", () => {
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

it("buildPorts attaches a workspace owner by cwd and leaves the rest external", () => {
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
    ],
  );
  assert.equal(ports[0].id, "127.0.0.1:50553:10");
});

it("sections groups workspaces by space, orders by name, and sorts ports", () => {
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
  assert.deepEqual(
    view.groups.map((group) => group.displayName),
    ["alpha", "zebra"],
  );
  assert.deepEqual(
    view.groups.map((group) => group.ports.map((port) => port.port)),
    [[3001, 8000], [3000]],
  );
  assert.deepEqual(
    view.external.map((port) => port.port),
    [80],
  );
  assert.equal(view.workspaceCount, 3);
  assert.equal(view.externalCount, 1);
});

it("panelHeight counts the sections it was given and stops at the scroll cap", () => {
  assert.equal(panelHeight(sections([]), false), PANEL.header + PANEL.empty + PANEL.group);
  const owned = (index: number, kind: Port["kind"]): Port => ({
    id: `p${index}`,
    bindHost: "localhost",
    pid: null,
    port: index + 1,
    kind,
    connectHost: "localhost",
    processName: "x",
    protocol: "unknown",
    owner: { spaceId: "s1", displayName: "alpha" },
  });
  const view = sections([
    owned(0, "workspace"),
    ...Array.from({ length: 40 }, (_, index) => owned(index + 1, "external")),
  ]);
  assert.equal(panelHeight(view, false), PANEL.header + PANEL.group + PANEL.row + PANEL.group);
  assert.equal(panelHeight(view, true), PANEL.header + PANEL.maxBody);
});

it("handles absent, blank, and partial scan records without inventing ports", () => {
  assert.deepEqual(parseListeners(null), []);
  assert.equal(parseCwds(null).size, 0);
  assert.equal(parseAddressWithPort(undefined), null);
  assert.deepEqual(parseListeners("\n"), []);
  assert.equal(parseCwds("\n").size, 0);
  assert.deepEqual(parseListeners("pNaN\nn127.0.0.1:80"), [
    {
      pid: null,
      processName: null,
      bindHost: "127.0.0.1",
      connectHost: "127.0.0.1",
      port: 80,
    },
  ]);
  assert.deepEqual(parseListeners("p1\nc\nn127.0.0.1:80")[0]?.processName, null);
  assert.deepEqual(parseListeners("p1\nnnot-an-address"), []);
  assert.equal(parseCwds("zzz\nn/orphan").size, 0);
  assert.equal(panelHeight(null, false), PANEL.header + PANEL.empty + PANEL.group);
  assert.deepEqual(sections(null), {
    groups: [],
    external: [],
    workspaceCount: 0,
    externalCount: 0,
  });
});

it("attributes root, nested, and unnamed spaces at their edges", () => {
  assert.equal(attributeSpace("/", [{ id: "root", name: "root", folders: ["/"] }]), "root");
  assert.equal(
    attributeSpace("/a/b/c", [
      { id: "deep", name: "deep", folders: ["/a/b"] },
      { id: "shallow", name: "shallow", folders: ["/a"] },
    ]),
    "deep",
  );
  assert.deepEqual(knownSpaces(null, null), []);
  assert.deepEqual(knownSpaces([{ id: "s", folder: "/x" }], null), [
    { id: "s", name: "", folders: ["/x"] },
  ]);
  assert.deepEqual(knownSpaces([{ id: "s", folder: "/x" }], [{ tab: "t", cwd: "/x/y" }]), [
    { id: "s", name: "", folders: ["/x"] },
  ]);
  assert.deepEqual(
    buildPorts(
      [{ pid: null, processName: null, bindHost: "*", connectHost: "localhost", port: 9 }],
      null,
      [],
    ).map((port) => port.kind),
    ["external"],
  );
});

it("orders equal-port externals and equal-named groups deterministically", () => {
  const external = sections(
    buildPorts(
      [
        { pid: 1, processName: null, bindHost: "*", connectHost: "localhost", port: 80 },
        { pid: 2, processName: "b", bindHost: "*", connectHost: "localhost", port: 80 },
      ],
      null,
      [],
    ),
  ).external;
  assert.deepEqual(
    external.map((port) => port.processName),
    [null, "b"],
  );

  const groups = sections(
    buildPorts(
      [
        { pid: 1, processName: "a", bindHost: "*", connectHost: "localhost", port: 3001 },
        { pid: 2, processName: "b", bindHost: "*", connectHost: "localhost", port: 3000 },
      ],
      new Map([
        [1, "/a"],
        [2, "/b"],
      ]),
      [
        { id: "s1", name: "same", folders: ["/a"] },
        { id: "s2", name: "same", folders: ["/b"] },
      ],
    ),
  ).groups;
  assert.deepEqual(
    groups.map((group) => group.ports[0]?.port),
    [3000, 3001],
  );
});

it("panelAt keeps the panel's bottom edge above the status bar", () => {
  assert.deepEqual(panelAt(1440, 900, 300), {
    x: 1440 - PANEL.width - PANEL.margin,
    y: 900 - PANEL.bar - PANEL.margin - 300,
  });

  assert.equal(panelAt(800, 400, 900).y, PANEL.margin);
});
