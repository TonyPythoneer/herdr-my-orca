import { exec } from "herdr";

                     
const SHELL = "sh";
const SHELL_SCRIPT_FLAG = "-c";
const COPY_LABEL = "copy";
const REVEAL_LABEL = "reveal";
const REVEAL_DIRECTORY_FLAG = "1";
const REVEAL_FILE_FLAG = "0";
const PARENT_DIRECTORY = /\/[^/]*$/;
const COPY_SCRIPT = "if command -v wl-copy >/dev/null 2>&1; then printf %s \"$1\" | wl-copy -n >/dev/null 2>&1; elif command -v xclip >/dev/null 2>&1; then printf %s \"$1\" | xclip -selection clipboard >/dev/null 2>&1; elif command -v pbcopy >/dev/null 2>&1; then printf %s \"$1\" | pbcopy >/dev/null 2>&1; elif command -v powershell.exe >/dev/null 2>&1; then printf %s \"$1\" | powershell.exe -NoProfile -Command \"$input | Set-Clipboard\" >/dev/null 2>&1; fi";
const REVEAL_SCRIPT = "if [ \"$(uname)\" = Darwin ]; then if [ \"$2\" = 1 ]; then open \"$1\"; else open -R \"$1\"; fi; elif command -v xdg-open >/dev/null 2>&1; then xdg-open \"$3\"; elif command -v explorer.exe >/dev/null 2>&1; then explorer.exe \"$3\"; fi >/dev/null 2>&1 &";
function isClipboardWriter(value) {
	return typeof value === "function";
}
function writeHostClipboard(text) {
	const writer = Reflect.get(globalThis, "__clipboard_write_text");
	if (!isClipboardWriter(writer)) return;
	try {
		writer.call(globalThis, text);
	} catch {}
}
function writeContextClipboard(text, cx) {
	if (!cx || typeof cx.write_to_clipboard !== "function") return;
	try {
		cx.write_to_clipboard(text);
	} catch {}
}
function copyText(value, cx) {
	const text = typeof value === "string" ? value : String(value ?? "");
	if (!text) return;
	writeHostClipboard(text);
	writeContextClipboard(text, cx);
	exec(SHELL, [
		SHELL_SCRIPT_FLAG,
		COPY_SCRIPT,
		COPY_LABEL,
		text
	]).catch(() => {});
}
function reveal(path, isDir = false) {
	const dir = isDir ? path : path.replace(PARENT_DIRECTORY, "") || path;
	exec(SHELL, [
		SHELL_SCRIPT_FLAG,
		REVEAL_SCRIPT,
		REVEAL_LABEL,
		path,
		isDir ? REVEAL_DIRECTORY_FLAG : REVEAL_FILE_FLAG,
		dir
	]).catch(() => {});
}

export { copyText, reveal };
