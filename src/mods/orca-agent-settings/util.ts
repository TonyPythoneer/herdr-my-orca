export function errorText(error: unknown): string {
  const message = (error as { message?: unknown } | null | undefined)?.message;
  return String(message ?? error ?? "unknown error");
}

export function tail(text: unknown, max = 500): string {
  const value = String(text ?? "").trim();
  return value.length > max ? `…${value.slice(-max)}` : value;
}

export function timeLabel(at: string | number | Date | null | undefined): string {
  if (!at) return "Not checked yet";
  return `Checked ${new Date(at).toTimeString().slice(0, 8)}`;
}

export function sameRun(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((part, index) => part === b[index]);
}
