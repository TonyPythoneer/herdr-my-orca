const STATUS = {
	blocked: "blocked",
	working: "working",
	done: "done",
	idle: "idle"
};
const STATUS_ORDER = [
	STATUS.blocked,
	STATUS.working,
	STATUS.done,
	STATUS.idle
];
const LIVE_STATE = "live";
function crewOf(all, address) {
	if (!address) return {
		managing: [],
		managedBy: null
	};
	const managing = all.filter((t) => t.parent === address && t.state === LIVE_STATE && t.status);
	const parentAddr = all.find((t) => t.address === address)?.parent ?? null;
	return {
		managing,
		managedBy: parentAddr ? anyAgent(all, parentAddr) : null
	};
}
function anyAgent(all, address) {
	return all.find((t) => t.address === address && t.status) ?? null;
}
function crewMembers(crew) {
	const seen =                 new Set();
	const members = [];
	for (const t of [...crew.managing, ...crew.managedBy ? [crew.managedBy] : []]) {
		if (seen.has(t.address)) continue;
		seen.add(t.address);
		members.push(t);
	}
	return members;
}
function crewGroups(crew) {
	const members = crewMembers(crew);
	const byStatus =                 new Map();
	for (const t of members) {
		const status = t.status;
		if (!status) continue;
		const list = byStatus.get(status);
		if (list) list.push(t);
		else byStatus.set(status, [t]);
	}
	const groups = [];
	for (const status of STATUS_ORDER) {
		const ms = byStatus.get(status);
		if (ms && ms.length) groups.push({
			status,
			members: ms
		});
	}
	return groups;
}
function crewSignature(crew) {
	return crewMembers(crew).map((t) => `${t.address}:${t.status}`).join(",");
}

export { STATUS, STATUS_ORDER, crewGroups, crewMembers, crewOf, crewSignature };
