// Port scan and grouping, as pure functions: no herdr or gpui imports, so `node --test` runs it.
//
// The shape is Orca's (`shared/workspace/ports/workspace-ports.ts`, `lib/workspace-ports/
// workspace-port-groups.ts`), cut down to what a Herdr mod can know:
//   - listeners come from `lsof -iTCP -sTCP:LISTEN` (Orca's macOS scan, darwin branch),
//   - a listener's owner comes from its process's cwd against the open spaces (Orca's `cwd`
//     attribution; the `command` fallback needs command lines, which a mod does not need),
//   - everything unmatched is an external port.
// Orca keys a port `host:port:pid` and drops repeats, which is how one wildcard listener seen on
// several file descriptors (and a forked server's copies) shows once.

const MAX_PORTS = 200;
const HTTPS_PORTS = new Set([443, 8443]);
const HTTP_PORTS = new Set([80, 3000, 3001, 4200, 5000, 5173, 5174, 8000, 8080, 8888]);

/** Wildcard binds are not openable addresses; Orca copies/opens localhost for them. */
export function connectHostForBindHost(host) {
  return host === "*" || host === "0.0.0.0" || host === "::" ? "localhost" : host;
}

/** `*:80`, `127.0.0.1:5000`, `[::1]:3000`. Bracketed IPv6 splits on the bracket, not the colon. */
export function parseAddressWithPort(value) {
  const text = String(value ?? "").trim();
  const match = text.match(/^\[([^\]]+)\]:(\d+)$/) ?? text.match(/^(.+):(\d+)$/);
  if (!match) return null;
  const port = Number.parseInt(match[2], 10);
  if (!Number.isFinite(port) || port < 1 || port > 65535) return null;
  return { host: match[1], port };
}

/** `lsof -Fpcn`: `p` opens a process, `c` names it, each `n` is one listening socket. */
export function parseListeners(stdout) {
  const listeners = [];
  let pid = null;
  let processName = null;
  for (const line of String(stdout ?? "").split("\n")) {
    if (!line) continue;
    const tag = line[0];
    const value = line.slice(1);
    if (tag === "p") {
      const parsed = Number.parseInt(value, 10);
      pid = Number.isFinite(parsed) ? parsed : null;
      processName = null;
    } else if (tag === "c") {
      processName = value || null;
    } else if (tag === "n") {
      const address = parseAddressWithPort(value);
      if (!address) continue;
      listeners.push({
        pid,
        processName,
        bindHost: address.host,
        connectHost: connectHostForBindHost(address.host),
        port: address.port,
      });
    }
  }
  return listeners;
}

/** `lsof -a -p 1,2 -d cwd -Fn`: a `p` line, then the `n` line holding that process's folder. */
export function parseCwds(stdout) {
  const cwds = new Map();
  let pid = null;
  for (const line of String(stdout ?? "").split("\n")) {
    if (!line) continue;
    if (line[0] === "p") {
      const parsed = Number.parseInt(line.slice(1), 10);
      pid = Number.isFinite(parsed) ? parsed : null;
    } else if (line[0] === "n" && pid !== null) {
      cwds.set(pid, line.slice(1) || null);
    }
  }
  return cwds;
}

export function dedupePorts(ports) {
  const seen = new Set();
  const kept = [];
  for (const port of ports) {
    const key = `${port.connectHost}:${port.port}:${port.pid ?? "unknown"}`;
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(port);
  }
  return kept;
}

/** Orca's port-number heuristic (local-workspace-port-attribution.ts:268-276). */
export function inferProtocol(port) {
  if (HTTPS_PORTS.has(port)) return "https";
  if (HTTP_PORTS.has(port)) return "http";
  return "unknown";
}

/** The address a person copies: `127.0.0.1:5000`, `[::1]:3000`. */
export function addressForPort(port) {
  const host = port.connectHost?.includes(":") ? `[${port.connectHost}]` : port.connectHost;
  return `${host}:${port.port}`;
}

export function browserUrlForPort(port) {
  return `${port.protocol === "https" ? "https" : "http"}://${addressForPort(port)}`;
}

const stripTrailingSlash = (path) => String(path ?? "").replace(/\/+$/, "");
const stripTrailingSlashAll = (path) => (path === "/" ? path : stripTrailingSlash(path));

/**
 * The spaces a scan can attribute to: this computer's open spaces, each with the folders a
 * listener may sit in — the space's own folder and its panes' live folders, because an agent that
 * `cd`s into a subfolder started its server from there.
 */
export function knownSpaces(spaceList, paneList) {
  return (spaceList ?? [])
    .filter((space) => space && !space.machine)
    .map((space) => {
      const tabs = new Set((space.tabs ?? []).map((tab) => tab.id));
      const folders = [
        stripTrailingSlashAll(space.folder),
        ...(paneList ?? [])
          .filter((pane) => pane && pane.cwd && tabs.has(pane.tab))
          .map((pane) => stripTrailingSlashAll(pane.cwd)),
      ].filter(Boolean);
      return { id: space.id, name: space.name ?? "", folders: [...new Set(folders)] };
    });
}

const contains = (path, folder) => path === folder || path.startsWith(`${folder}/`);

/** Deepest matching folder wins, so a worktree inside another checkout's folder still wins. */
export function attributeSpace(cwd, known) {
  const path = stripTrailingSlashAll(cwd);
  if (!path) return null;
  let best = null;
  for (const space of known) {
    for (const folder of space.folders) {
      if (!contains(path, folder)) continue;
      if (!best || folder.length > best.folder.length) best = { id: space.id, folder };
    }
  }
  return best?.id ?? null;
}

/** One `WorkspacePort` per listening socket, owned or external. Shape:
 *  `shared/workspace/ports/workspace-ports.ts`. */
export function buildPorts(listeners, cwds, known) {
  const byId = new Map((known ?? []).map((space) => [space.id, space]));
  const ports = [];
  for (const listener of listeners) {
    const ownerId = attributeSpace(cwds?.get(listener.pid) ?? null, known);
    const owner = ownerId ? byId.get(ownerId) : null;
    ports.push({
      id: `${listener.connectHost}:${listener.port}:${listener.pid ?? "unknown"}`,
      bindHost: listener.bindHost,
      connectHost: listener.connectHost,
      port: listener.port,
      pid: listener.pid,
      processName: listener.processName,
      protocol: inferProtocol(listener.port),
      kind: owner ? "workspace" : "external",
      owner: owner ? { spaceId: owner.id, displayName: owner.name } : undefined,
    });
  }
  return dedupePorts(ports).slice(0, MAX_PORTS);
}

const comparePorts = (a, b) =>
  a.port - b.port || String(a.processName ?? "").localeCompare(String(b.processName ?? ""));

/** The popover's two regions: workspace groups (Orca orders them by display name) and externals. */
export function sections(ports) {
  const groups = new Map();
  const external = [];
  for (const port of ports ?? []) {
    if (port.kind !== "workspace" || !port.owner) {
      external.push(port);
      continue;
    }
    const current = groups.get(port.owner.spaceId) ?? {
      spaceId: port.owner.spaceId,
      displayName: port.owner.displayName,
      ports: [],
    };
    current.ports.push(port);
    groups.set(port.owner.spaceId, current);
  }
  const ordered = [...groups.values()]
    .map((group) => ({ ...group, ports: [...group.ports].sort(comparePorts) }))
    .sort(
      (a, b) =>
        String(a.displayName).localeCompare(String(b.displayName)) ||
        (a.ports[0]?.port ?? 0) - (b.ports[0]?.port ?? 0)
    );
  const workspaceCount = ordered.reduce((count, group) => count + group.ports.length, 0);
  return {
    groups: ordered,
    external: [...external].sort(comparePorts),
    workspaceCount,
    externalCount: external.length,
  };
}

// The popover's own geometry, in px, so its height can be known before it is drawn
// (openOverlay takes a height; a content-sized popup could not be anchored to the bar).
// Orca's numbers at 100%: 24rem wide, a 28rem scroll cap, py-1.5 rows of two lines,
// px-3 py-2 section headers (StatusBarSurface/PortsStatusSegment).
export const PANEL = {
  width: 384,
  margin: 8,
  bar: 20,
  header: 34,
  group: 34,
  row: 46,
  empty: 48,
  maxBody: 448,
};

/** How tall the popover is for what it will show, scroll cap included. */
export function panelHeight(view, externalOpen) {
  const groups = view?.groups ?? [];
  const external = view?.external ?? [];
  const body =
    groups.reduce((height, group) => height + PANEL.group + group.ports.length * PANEL.row, 0) +
    (groups.length === 0 ? PANEL.empty : 0) +
    PANEL.group +
    (externalOpen ? external.length * PANEL.row : 0);
  return PANEL.header + Math.min(body, PANEL.maxBody);
}

/** Where the panel goes: bottom-right, its bottom edge just above the status bar. */
export function panelAt(viewportWidth, viewportHeight, height) {
  return {
    x: Math.max(PANEL.margin, Math.round(viewportWidth - PANEL.width - PANEL.margin)),
    y: Math.max(PANEL.margin, Math.round(viewportHeight - PANEL.bar - PANEL.margin - height)),
  };
}
