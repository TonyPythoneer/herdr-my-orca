type HostExec = (command: string, args?: string[]) => Promise<{ code: number }>;
type TestGlobal = typeof globalThis & {
  __herdrChecking?: () => boolean;
  __herdrExec?: HostExec;
  __herdrShared?: (key: string) => unknown;
  __herdrSetShared?: (key: string, value: unknown) => void;
  __herdrProps?: () => unknown;
  __herdrLayout?: () => unknown;
  __herdrTheme?: () => Record<string, string>;
  __herdrReadTextFile?: (path: string) => Promise<string | null>;
  __herdrWriteTextFile?: (path: string, text: string, expected?: string | null) => Promise<null>;
  __herdrSpaces?: () => unknown[];
  __herdrSettings?: () => Record<string, unknown>;
  __herdrPanes?: () => Array<{ tab?: string | null; cwd?: string | null }>;
  __herdrOpenOverlay?: (spec: unknown) => string;
  __herdrCloseOverlay?: (id?: string) => void;
  __herdrNotify?: (message: unknown) => void;
  __herdrRun?: (...args: unknown[]) => void;
  __herdrWindow?: () => { platform: "linux" | "macos" | "windows" } | null;
  __herdrNextCommand?: () => Promise<string>;
};
import { agentConfigRuntime } from "../support/agent-config-runtime.js";

const runtime = () => agentConfigRuntime();
const clean = (value: unknown): unknown =>
  value === undefined
    ? null
    : JSON.parse(JSON.stringify(value, (_key, item) => (typeof item === "function" ? "fn" : item)));

function execResult(
  state: NonNullable<ReturnType<typeof runtime>>,
  command: string,
  args: string[],
): unknown {
  if (command === "zsh")
    return args[1]?.includes("--version") ? state.world.exec?.version : state.world.exec?.models;
  if (command === "ls") return state.world.exec?.ls;
  if (command === "python3") return state.world.exec?.gateway;
  return undefined;
}

function expectedText(expected: string | null | undefined): string | null {
  if (expected === undefined) return "<none>";
  return expected === null ? null : "<prev>";
}

export function checking(): boolean {
  const state = runtime();
  return state
    ? Boolean(state.world.checking)
    : ((globalThis as TestGlobal).__herdrChecking?.() ?? true);
}

export async function exec(
  command: string,
  args: string[] = [],
): Promise<{ code: number; stdout?: string }> {
  const state = runtime();
  if (!state) return (globalThis as TestGlobal).__herdrExec?.(command, args) ?? { code: 0 };
  state.log.push([
    "exec",
    command,
    args[0] === "-lic" ? (args[1] ?? "").replace(/'[^']*'/g, "'…'").slice(0, 60) : args,
  ]);
  const value = execResult(state, command, args);
  if (value instanceof Error) throw value;
  if (typeof value === "string") return { code: 0, stdout: value };
  if (value !== undefined) return { code: 0, stdout: String(value) };
  return { code: 0, stdout: "" };
}

export function shared(key: string): unknown {
  return (globalThis as TestGlobal).__herdrShared?.(key);
}

export function setShared(key: string, value: unknown): void {
  if (runtime()) runtime()?.log.push(["setShared", key, value]);
  (globalThis as TestGlobal).__herdrSetShared?.(key, value);
}

export function props(): unknown {
  const state = runtime();
  return state
    ? {
        key: state.world.key,
        space: "s1",
        name: state.world.key,
        argv: state.world.argv,
        launchNow: Boolean(state.world.launchNow),
        machine: state.world.machine ?? null,
        overlay: "ov",
        menu: "menu",
      }
    : (globalThis as TestGlobal).__herdrProps?.();
}

export function layout(): unknown {
  return (globalThis as TestGlobal).__herdrLayout?.();
}

export function theme(): Record<string, string> {
  return (
    (globalThis as TestGlobal).__herdrTheme?.() ??
    new Proxy({}, { get: (_target, key) => `#${String(key)}` })
  );
}

export function appHome(): string {
  return "/home";
}

export function home(): string {
  return runtime() ? "/home" : "/home/test";
}

export function run(...args: unknown[]): null {
  runtime()?.log.push(["run", ...(clean(args) as unknown[])]);
  (globalThis as TestGlobal).__herdrRun?.(...args);
  return null;
}

export function closeOverlay(id?: string): null {
  if (runtime()) runtime()?.log.push(["closeOverlay", id]);
  (globalThis as TestGlobal).__herdrCloseOverlay?.(id);
  return null;
}

export function openOverlay(spec: unknown): string {
  return (globalThis as TestGlobal).__herdrOpenOverlay?.(spec) ?? "overlay-test";
}

export function notify(message: unknown): string {
  (globalThis as TestGlobal).__herdrNotify?.(message);
  return "notification-test";
}

export function panes(): Array<{ tab?: string | null; cwd?: string | null }> {
  return (globalThis as TestGlobal).__herdrPanes?.() ?? [];
}

export function window(): { platform: "linux" | "macos" | "windows" } | null {
  return (globalThis as TestGlobal).__herdrWindow?.() ?? { platform: "linux" };
}

export function nextCommand(): Promise<string> {
  return (globalThis as TestGlobal).__herdrNextCommand?.() ?? new Promise(() => {});
}

export function readTextFile(path: string): Promise<string | null> {
  return Promise.resolve(
    runtime()?.files.get(path) ?? (globalThis as TestGlobal).__herdrReadTextFile?.(path) ?? null,
  );
}

export function writeTextFile(path: string, text: string, expected?: string | null): Promise<null> {
  const state = runtime();
  if (state) {
    state.log.push(["write", path, text, expectedText(expected)]);
    state.files.set(path, text);
    return Promise.resolve(null);
  }
  return (
    (globalThis as TestGlobal).__herdrWriteTextFile?.(path, text, expected) ?? Promise.resolve(null)
  );
}

export function settings(): Record<string, unknown> {
  const state = runtime();
  return state
    ? { dark: state.world.dark !== false, font_family: "Mono" }
    : ((globalThis as TestGlobal).__herdrSettings?.() ?? {});
}

export function spaces(): Array<{
  id: string;
  machine: string | null;
  folder: string;
  active: boolean;
}> {
  const state = runtime();
  return state
    ? [{ id: "s1", active: true, machine: state.world.machine ?? null, folder: "/repo" }]
    : (((globalThis as TestGlobal).__herdrSpaces?.() ?? []) as unknown as ReturnType<
        typeof spaces
      >);
}
