const MAX_PORTS = 200;
const HTTPS_PORTS =                 new Set([443, 8443]);
const HTTP_PORTS =                 new Set([
	80,
	3e3,
	3001,
	4200,
	5e3,
	5173,
	5174,
	8e3,
	8080,
	8888
]);
const LINE_BREAK = "\n";
const UNKNOWN_PID = "unknown";
const LSOF_FIELD = {
	pid: "p",
	command: "c",
	name: "n"
};
const PROTOCOL = {
	http: "http",
	https: "https",
	unknown: "unknown"
};
const KIND = {
	workspace: "workspace",
	external: "external"
};
const ANY_HOST_BINDS =                 new Set([
	"*",
	"0.0.0.0",
	"::"
]);
const LOCALHOST = "localhost";
function splitLines(stdout) {
	return String(stdout ?? "").split(LINE_BREAK);
}
function parsePid(value) {
	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) ? parsed : null;
}
function portKey(port) {
	return `${port.connectHost}:${port.port}:${port.pid ?? UNKNOWN_PID}`;
}
function connectHostForBindHost(host) {
	return ANY_HOST_BINDS.has(host) ? LOCALHOST : host;
}
function parseAddressWithPort(value) {
	const text = String(value ?? "").trim();
	const match = text.match(/^\[([^\]]+)\]:(\d+)$/) ?? text.match(/^(.+):(\d+)$/);
	if (!match) return null;
	const port = Number.parseInt(match[2], 10);
	if (!Number.isFinite(port) || port < 1 || port > 65535) return null;
	return {
		host: match[1],
		port
	};
}
function parseListeners(stdout) {
	const listeners = [];
	let pid = null;
	let processName = null;
	for (const line of splitLines(stdout)) {
		if (!line) continue;
		const tag = line[0];
		const value = line.slice(1);
		if (tag === LSOF_FIELD.pid) {
			pid = parsePid(value);
			processName = null;
		} else if (tag === LSOF_FIELD.command) processName = value || null;
		else if (tag === LSOF_FIELD.name) {
			const address = parseAddressWithPort(value);
			if (!address) continue;
			listeners.push({
				pid,
				processName,
				bindHost: address.host,
				connectHost: connectHostForBindHost(address.host),
				port: address.port
			});
		}
	}
	return listeners;
}
function parseCwds(stdout) {
	const cwds =                 new Map();
	let pid = null;
	for (const line of splitLines(stdout)) {
		if (!line) continue;
		if (line[0] === LSOF_FIELD.pid) pid = parsePid(line.slice(1));
		else if (line[0] === LSOF_FIELD.name && pid !== null) cwds.set(pid, line.slice(1) || null);
	}
	return cwds;
}
function dedupePorts(ports) {
	const seen =                 new Set();
	const kept = [];
	for (const port of ports) {
		const key = portKey(port);
		if (seen.has(key)) continue;
		seen.add(key);
		kept.push(port);
	}
	return kept;
}
function inferProtocol(port) {
	if (HTTPS_PORTS.has(port)) return PROTOCOL.https;
	if (HTTP_PORTS.has(port)) return PROTOCOL.http;
	return PROTOCOL.unknown;
}
function addressForPort(port) {
	return `${port.connectHost?.includes(":") ? `[${port.connectHost}]` : port.connectHost}:${port.port}`;
}
function browserUrlForPort(port) {
	return `${port.protocol === PROTOCOL.https ? PROTOCOL.https : PROTOCOL.http}://${addressForPort(port)}`;
}
const stripTrailingSlash = (path) => String(path ?? "").replace(/\/+$/, "");
const stripTrailingSlashAll = (path) => path === "/" ? path : stripTrailingSlash(path);
function knownSpaces(spaceList, paneList) {
	return (spaceList ?? []).filter((space) => space && !space.machine).map((space) => {
		const tabs = new Set((space.tabs ?? []).map((tab) => tab.id));
		const folders = [stripTrailingSlashAll(space.folder), ...(paneList ?? []).filter((pane) => pane && pane.cwd && tabs.has(pane.tab)).map((pane) => stripTrailingSlashAll(pane.cwd))].filter(Boolean);
		return {
			id: space.id,
			name: space.name ?? "",
			folders: [...new Set(folders)]
		};
	});
}
const contains = (path, folder) => path === folder || path.startsWith(`${folder}/`);
function attributeSpace(cwd, known) {
	const path = stripTrailingSlashAll(cwd);
	if (!path) return null;
	let best = null;
	for (const space of known) for (const folder of space.folders) {
		if (!contains(path, folder)) continue;
		if (!best || folder.length > best.folder.length) best = {
			id: space.id,
			folder
		};
	}
	return best?.id ?? null;
}
function buildPorts(listeners, cwds, known) {
	const byId = new Map((known ?? []).map((space) => [space.id, space]));
	const ports = [];
	for (const listener of listeners) {
		const ownerId = attributeSpace(cwds?.get(listener.pid) ?? null, known);
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
			owner: owner ? {
				spaceId: owner.id,
				displayName: owner.name
			} : void 0
		});
	}
	return dedupePorts(ports).slice(0, MAX_PORTS);
}
const comparePorts = (a, b) => a.port - b.port || String(a.processName ?? "").localeCompare(String(b.processName ?? ""));
function sections(ports) {
	const groups =                 new Map();
	const external = [];
	for (const port of ports ?? []) {
		if (port.kind !== KIND.workspace || !port.owner) {
			external.push(port);
			continue;
		}
		const current = groups.get(port.owner.spaceId) ?? {
			spaceId: port.owner.spaceId,
			displayName: port.owner.displayName,
			ports: []
		};
		current.ports.push(port);
		groups.set(port.owner.spaceId, current);
	}
	const ordered = [...groups.values()].map((group) => ({
		...group,
		ports: [...group.ports].sort(comparePorts)
	})).sort((a, b) => String(a.displayName).localeCompare(String(b.displayName)) || (a.ports[0]?.port ?? 0) - (b.ports[0]?.port ?? 0));
	const workspaceCount = ordered.reduce((count, group) => count + group.ports.length, 0);
	return {
		groups: ordered,
		external: [...external].sort(comparePorts),
		workspaceCount,
		externalCount: external.length
	};
}
const PANEL = {
	width: 384,
	margin: 8,
	bar: 20,
	header: 34,
	group: 34,
	row: 46,
	empty: 48,
	maxBody: 448
};
function panelHeight(view, externalOpen) {
	const groups = view?.groups ?? [];
	const external = view?.external ?? [];
	const body = groups.reduce((height, group) => height + PANEL.group + group.ports.length * PANEL.row, 0) + (groups.length === 0 ? PANEL.empty : 0) + PANEL.group + (externalOpen ? external.length * PANEL.row : 0);
	return PANEL.header + Math.min(body, PANEL.maxBody);
}
function panelAt(viewportWidth, viewportHeight, height) {
	return {
		x: Math.max(PANEL.margin, Math.round(viewportWidth - PANEL.width - PANEL.margin)),
		y: Math.max(PANEL.margin, Math.round(viewportHeight - PANEL.bar - PANEL.margin - height))
	};
}

export { PANEL, addressForPort, attributeSpace, browserUrlForPort, buildPorts, connectHostForBindHost, dedupePorts, inferProtocol, knownSpaces, panelAt, panelHeight, parseAddressWithPort, parseCwds, parseListeners, sections };
