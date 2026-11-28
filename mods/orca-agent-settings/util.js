function errorText(error) {
	const message = error?.message;
	return String(message ?? error ?? "unknown error");
}
function tail(text, max = 500) {
	const value = String(text ?? "").trim();
	return value.length > max ? `…${value.slice(-max)}` : value;
}
function timeLabel(at) {
	if (!at) return "Not checked yet";
	return `Checked ${new Date(at).toTimeString().slice(0, 8)}`;
}
function sameRun(a, b) {
	return a.length === b.length && a.every((part, index) => part === b[index]);
}

export { errorText, sameRun, tail, timeLabel };
