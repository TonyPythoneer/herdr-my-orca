function closeSideTabs(owner, id, side) {
	const list = owner?.tabs ?? [];
	const at = list.findIndex((x) => x.id === id);
	if (at < 0) return [];
	const range = side === "left" ? [0, at] : [at + 1];
	return list.slice(...range).filter((x) => !x.settled).map((x) => x.id);
}

export { closeSideTabs };
