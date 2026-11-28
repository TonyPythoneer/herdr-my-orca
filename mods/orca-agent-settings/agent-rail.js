function railRows(rows) {
	return [...rows.filter((row) => row.installed), ...rows.filter((row) => !row.installed)];
}

export { railRows };
