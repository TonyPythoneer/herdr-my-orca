// Pure helpers for the Agent Manager page.
export function errorText(error) {
  return String(error?.message ?? error ?? "unknown error");
}

export function tail(text, max = 500) {
  const value = String(text ?? "").trim();
  return value.length > max ? `…${value.slice(-max)}` : value;
}

export function timeLabel(at) {
  if (!at) return "Not checked yet";
  return `Checked ${new Date(at).toTimeString().slice(0, 8)}`;
}

export function sameRun(a, b) {
  return a.length === b.length && a.every((part, index) => part === b[index]);
}
