const GATES = {
	gitOnly: ({ isFolder }) => !isFolder,
	folderOnly: ({ isFolder }) => isFolder,
	sshOnly: ({ onSshHost }) => onSshHost
};
function visibleTools(items, state) {
	return items.filter(({ gating }) => !Object.hasOwn(GATES, gating ?? "") || GATES[gating ?? ""](state));
}
function fallbackChild(visible, active) {
	if (!visible.length) return null;
	return visible.some((tool) => tool.id === active) ? active : visible[0].id;
}

export { fallbackChild, visibleTools };
