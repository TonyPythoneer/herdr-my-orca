const VIEW_REVEALS = {
	files: { child: "files" },
	search: {
		child: "files",
		mod: "orca-files.search"
	},
	changes: { child: "changes" },
	ports: { child: "ports" }
};
function viewCommands(view) {
	const target = VIEW_REVEALS[view];
	if (!target) return null;
	const commands = [{
		name: "layout.show",
		args: { id: "panel" }
	}, {
		name: "layout.select",
		args: {
			stack: "panel-body",
			child: target.child
		}
	}];
	if (target.mod) commands.push({ name: target.mod });
	return commands;
}

export { VIEW_REVEALS, viewCommands };
