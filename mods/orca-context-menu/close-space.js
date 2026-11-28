function closeRows(ids, label = "Close workspace") {
	const list = [...new Set((ids ?? []).filter((id) => Boolean(id)))];
	if (list.length === 0) return [];
	if (list.length === 1) return [[
		label,
		"space.close",
		{
			id: list[0],
			confirmed: true
		}
	]];
	return [[
		label,
		"orca-context-menu.close-group",
		{ ids: list }
	]];
}

export { closeRows };
