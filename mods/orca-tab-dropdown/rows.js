import { OFFICIAL_AGENT_KEYS } from "./agent-catalog.js";

                                     
function agentWindow(total, start, full = 5) {
	const last = Math.max(0, total - full);
	const at = Math.max(0, Math.min(start, last));
	return {
		start: at,
		count: Math.min(total - at, at < last ? full + 1 : full),
		left: at > 0,
		right: at < last
	};
}
function installedEnabledAgents(agents, disabled) {
	const seen =                 new Set();
	return (agents ?? []).filter((agent) => {
		if (!agent || typeof agent.key !== "string" || !OFFICIAL_AGENT_KEYS.has(agent.key) || disabled.has(agent.key) || seen.has(agent.key)) return false;
		if (!agent.installed) return false;
		seen.add(agent.key);
		return true;
	});
}
const offeredAgents = installedEnabledAgents;
function freebuffVisible(detected) {
	return detected === true;
}
function freebuffRun(agents) {
	const run = (agents ?? []).find((agent) => agent?.key === "freebuff")?.run;
	if (Array.isArray(run) && run.length && run.every((part) => typeof part === "string")) return [...run];
	return [
		"zsh",
		"-lic",
		"exec freebuff"
	];
}
function emptyAgentState(officialCount, freebuff) {
	return officialCount === 0 && !freebuff;
}
function mergeInventory(known, inventory) {
	if (!Array.isArray(inventory) || inventory.length === 0) return known ?? [];
	if (!Array.isArray(known) || known.length === 0) return inventory;
	const fresh = new Map(inventory.filter((agent) => agent?.key).map((agent) => [agent.key, agent]));
	return known.map((agent) => {
		const current = fresh.get(agent.key);
		if (!current) return agent;
		const run = Array.isArray(current.run) && current.run.length ? [...current.run] : agent.run;
		return {
			...agent,
			installed: Boolean(current.installed),
			run
		};
	});
}
function currentInventory(inventory, now = Date.now()) {
	const value = inventory;
	return value && Array.isArray(value.agents) && now - Number(value.at) < 12e4 ? value : null;
}

export { agentWindow, currentInventory, emptyAgentState, freebuffRun, freebuffVisible, installedEnabledAgents, mergeInventory, offeredAgents };
