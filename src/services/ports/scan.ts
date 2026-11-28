const MAX_PORTS = 200;
const HTTPS_PORTS = new Set([443, 8443]);
const HTTP_PORTS = new Set([80, 3000, 3001, 4200, 5000, 5173, 5174, 8000, 8080, 8888]);

const LINE_BREAK = "\n";
const UNKNOWN_PID = "unknown";
const LSOF_FIELD = { pid: "p", command: "c", name: "n" } as const;
const PROTOCOL = { http: "http", https: "https", unknown: "unknown" } as const;
const KIND = { workspace: "workspace", external: "external" } as const;
const ANY_HOST_BINDS = new Set(["*", "0.0.0.0", "::"]);
const LOCALHOST = "localhost";

type Protocol = (typeof PROTOCOL)[keyof typeof PROTOCOL];
type PortKind = (typeof KIND)[keyof typeof KIND];

export type PortListener = {
  pid: number | null;
  processName: string | null;
  bindHost: string;
  connectHost: string;
  port: number;
};

export type KnownSpace = {
  id: string;
  name: string;
  folders: string[];
};

type SpaceRecord = {
  id: string;
  name?: string | null;
  folder?: string | null;
  machine?: string | null;
  tabs?: readonly { id: string }[];
};

type PaneRecord = { tab?: string | null; cwd?: string | null };

export type Port = PortListener & {
  id: string;
  protocol: Protocol;
  kind: PortKind;
  owner?: { spaceId: string; displayName: string };
};

export type PortGroup = {
  spaceId: string;
  displayName: string;
  ports: Port[];
};

export type PortSections = {
  groups: PortGroup[];
  external: Port[];
  workspaceCount: number;
  externalCount: number;
};

function splitLines(stdout: unknown): string[] {
  return String(stdout ?? "").split(LINE_BREAK);
}

function parsePid(value: string): number | null {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function portKey(port: PortListener): string {
  return `${port.connectHost}:${port.port}:${port.pid ?? UNKNOWN_PID}`;
}

export function connectHostForBindHost(host: string): string {
  return ANY_HOST_BINDS.has(host) ? LOCALHOST : host;
}

export function parseAddressWithPort(value: unknown): { host: string; port: number } | null {
  const text = String(value ?? "").trim();
  const match = text.match(/^\[([^\]]+)\]:(\d+)$/) ?? text.match(/^(.+):(\d+)$/);
  if (!match) return null;
  const port = Number.parseInt(match[2], 10);
  if (!Number.isFinite(port) || port < 1 || port > 65535) return null;
  return { host: match[1], port };
}

export function parseListeners(stdout: unknown): PortListener[] {
  const listeners: PortListener[] = [];
  let pid: number | null = null;
  let processName: string | null = null;
  for (const line of splitLines(stdout)) {
    if (!line) continue;
    const tag = line[0];
    const value = line.slice(1);
    if (tag === LSOF_FIELD.pid) {
      pid = parsePid(value);
      processName = null;
    } else if (tag === LSOF_FIELD.command) {
      processName = value || null;
    } else if (tag === LSOF_FIELD.name) {
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

export function parseCwds(stdout: unknown): Map<number, string | null> {
  const cwds = new Map<number, string | null>();
  let pid: number | null = null;
  for (const line of splitLines(stdout)) {
    if (!line) continue;
    if (line[0] === LSOF_FIELD.pid) {
      pid = parsePid(line.slice(1));
    } else if (line[0] === LSOF_FIELD.name && pid !== null) {
      cwds.set(pid, line.slice(1) || null);
    }
  }
  return cwds;
}

export function dedupePorts<T extends PortListener>(ports: readonly T[]): T[] {
  const seen = new Set<string>();
  const kept: T[] = [];
  for (const port of ports) {
    const key = portKey(port);
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(port);
  }
  return kept;
}

export function inferProtocol(port: number): Protocol {
  if (HTTPS_PORTS.has(port)) return PROTOCOL.https;
  if (HTTP_PORTS.has(port)) return PROTOCOL.http;
  return PROTOCOL.unknown;
}

export function addressForPort(port: Pick<PortListener, "connectHost" | "port">): string {
  const host = port.connectHost?.includes(":") ? `[${port.connectHost}]` : port.connectHost;
  return `${host}:${port.port}`;
}

export function browserUrlForPort(port: Pick<Port, "connectHost" | "port" | "protocol">): string {
  const scheme = port.protocol === PROTOCOL.https ? PROTOCOL.https : PROTOCOL.http;
  return `${scheme}://${addressForPort(port)}`;
}

const stripTrailingSlash = (path: unknown): string => String(path ?? "").replace(/\/+$/, "");
const stripTrailingSlashAll = (path: unknown): string =>
  path === "/" ? path : stripTrailingSlash(path);

export function knownSpaces(
  spaceList: readonly SpaceRecord[] | null | undefined,
  paneList: readonly PaneRecord[] | null | undefined,
): KnownSpace[] {
  return (spaceList ?? [])
    .filter((space) => space && !space.machine)
    .map((space) => {
      const tabs = new Set<string | null | undefined>((space.tabs ?? []).map((tab) => tab.id));
      const folders = [
        stripTrailingSlashAll(space.folder),
        ...(paneList ?? [])
          .filter((pane) => pane && pane.cwd && tabs.has(pane.tab))
          .map((pane) => stripTrailingSlashAll(pane.cwd)),
      ].filter(Boolean);
      return { id: space.id, name: space.name ?? "", folders: [...new Set(folders)] };
    });
}

const contains = (path: string, folder: string): boolean =>
  path === folder || path.startsWith(`${folder}/`);

export function attributeSpace(
  cwd: string | null | undefined,
  known: readonly KnownSpace[],
): string | null {
  const path = stripTrailingSlashAll(cwd);
  if (!path) return null;
  let best: { id: string; folder: string } | null = null;
  for (const space of known) {
    for (const folder of space.folders) {
      if (!contains(path, folder)) continue;
      if (!best || folder.length > best.folder.length) best = { id: space.id, folder };
    }
  }
  return best?.id ?? null;
}

export function buildPorts(
  listeners: readonly PortListener[],
  cwds: ReadonlyMap<number, string | null> | null | undefined,
  known: readonly KnownSpace[],
): Port[] {
  const byId = new Map((known ?? []).map((space) => [space.id, space]));
  const ports: Port[] = [];
  for (const listener of listeners) {
    const cwd = cwds?.get(listener.pid as number) ?? null;
    const ownerId = attributeSpace(cwd, known);
    const owner = ownerId ? byId.get(ownerId) : null;
    ports.push({
      id: portKey(listener),
      bindHost: listener.bindHost,
      connectHost: listener.connectHost,
      port: listener.port,
      pid: listener.pid,
      processName: listener.processName,
      protocol: inferProtocol(listener.port),
      kind: owner ? KIND.workspace : KIND.external,
      owner: owner ? { spaceId: owner.id, displayName: owner.name } : undefined,
    });
  }
  return dedupePorts(ports).slice(0, MAX_PORTS);
}

const comparePorts = (a: Port, b: Port): number =>
  a.port - b.port || String(a.processName ?? "").localeCompare(String(b.processName ?? ""));

export function sections(ports: readonly Port[] | null | undefined): PortSections {
  const groups = new Map<string, PortGroup>();
  const external: Port[] = [];
  for (const port of ports ?? []) {
    if (port.kind !== KIND.workspace || !port.owner) {
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
        (a.ports[0]?.port ?? 0) - (b.ports[0]?.port ?? 0),
    );
  const workspaceCount = ordered.reduce((count, group) => count + group.ports.length, 0);
  return {
    groups: ordered,
    external: [...external].sort(comparePorts),
    workspaceCount,
    externalCount: external.length,
  };
}

export const PANEL = {
  width: 384,
  margin: 8,
  bar: 20,
  header: 34,
  group: 34,
  row: 46,
  empty: 48,
  maxBody: 448,
} as const;

export function panelHeight(view: PortSections | null | undefined, externalOpen: boolean): number {
  const groups = view?.groups ?? [];
  const external = view?.external ?? [];
  const body =
    groups.reduce((height, group) => height + PANEL.group + group.ports.length * PANEL.row, 0) +
    (groups.length === 0 ? PANEL.empty : 0) +
    PANEL.group +
    (externalOpen ? external.length * PANEL.row : 0);
  return PANEL.header + Math.min(body, PANEL.maxBody);
}

export function panelAt(
  viewportWidth: number,
  viewportHeight: number,
  height: number,
): { x: number; y: number } {
  return {
    x: Math.max(PANEL.margin, Math.round(viewportWidth - PANEL.width - PANEL.margin)),
    y: Math.max(PANEL.margin, Math.round(viewportHeight - PANEL.bar - PANEL.margin - height)),
  };
}
