import type { Context } from "gpui-kit";
import { InputState } from "gpui-base";
import Flyout from "../../../src/mods/orca-agent-flyout/main.js";
import { SPECS, defaultValues } from "../../../src/shared/agent-flyout.js";

export type FlyoutView = InstanceType<typeof Flyout>;
export type Theme = Parameters<FlyoutView["modelList"]>[0];
export type PreviewResult = Awaited<ReturnType<FlyoutView["buildPreview"]>>;
export type FlyoutKey = keyof typeof SPECS;
export type Reply = { code: number; stdout?: string; stderr?: string };
export type HostExec = (command: string, args: string[]) => Reply | Promise<Reply>;
type HostGlobals = typeof globalThis & {
  __herdrChecking?: () => boolean;
  __herdrProps?: () => unknown;
  __herdrSpaces?: () => unknown;
  __herdrRun?: (command: string, args?: unknown) => void;
  __herdrExec?: (command: string, args: string[]) => Promise<Reply>;
  __herdrReadTextFile?: (path: string) => Promise<string | null>;
  __herdrWriteTextFile?: (path: string, text: string) => Promise<null>;
  __herdrSetShared?: (key: string, value: unknown) => void;
  __herdrCloseOverlay?: (id?: string) => void;
};
const host = globalThis as HostGlobals;

export type HostOptions = {
  files?: Map<string, string>;
  props?: () => unknown;
  machine?: string | null;
  exec?: HostExec;
  shared?: (key: string, value: unknown) => void;
  closeOverlay?: (id?: string) => void;
};

export const DIRECT_GATEWAY = '{"direct":true}';
const DEFAULT_PROPS = () => ({ key: "codex", space: "s1", name: "Codex", argv: ["codex"] });

export function installHost(options: HostOptions = {}): {
  files: Map<string, string>;
  runs: [string, unknown][];
} {
  const files = options.files ?? new Map<string, string>();
  const runs: [string, unknown][] = [];
  const custom = options.exec;
  host.__herdrChecking = () => false;
  host.__herdrProps = options.props ?? DEFAULT_PROPS;
  host.__herdrSpaces = () => [{ id: "s1", active: true, machine: options.machine ?? null }];
  host.__herdrReadTextFile = async (path) => files.get(path) ?? null;
  host.__herdrWriteTextFile = async (path, text) => {
    files.set(path, text);
    return null;
  };
  host.__herdrRun = (command, args) => {
    runs.push([String(command), args]);
  };
  host.__herdrSetShared = options.shared;
  host.__herdrCloseOverlay = options.closeOverlay;
  host.__herdrExec = async (command, args) => {
    const prepare =
      command === "python3" && args[0]?.endsWith("/litellm_gateway.py") && args[2] === "prepare";
    const result = (await custom?.(command, args)) ?? { code: 0, stdout: "", stderr: "" };
    return prepare && result.code === 0 && !(result.stdout ?? "").trim()
      ? { code: 0, stdout: DIRECT_GATEWAY, stderr: "" }
      : result;
  };
  return { files, runs };
}

export function resetHost(): void {
  delete host.__herdrChecking;
  delete host.__herdrProps;
  delete host.__herdrSpaces;
  delete host.__herdrReadTextFile;
  delete host.__herdrWriteTextFile;
  delete host.__herdrRun;
  delete host.__herdrExec;
  delete host.__herdrSetShared;
  delete host.__herdrCloseOverlay;
}

export function flyoutView(key: FlyoutKey, state: Record<string, unknown> = {}): FlyoutView {
  return Object.assign(new Flyout(), { key, spec: SPECS[key], ...state });
}

export function defaults(
  key: FlyoutKey,
  state: Record<string, unknown> = {},
): Record<string, unknown> {
  return { ...defaultValues(SPECS[key]), ...state };
}

export const input = (value = ""): InputState => InputState.new({ value });

export const THEME: Theme = (() => {
  const target: Theme = { accent: "#accent", surface: "#surface", hover: "#hover" };
  return new Proxy(target, {
    get: (object, key) =>
      typeof key === "string" && !(key in object) ? `#${key}` : Reflect.get(object, key),
  });
})();

export function nodeOf(value: unknown): unknown {
  if (typeof value !== "object" || value === null) return value;
  return Reflect.get(value, "__node") ?? value;
}

export function textOf(value: unknown): string {
  return JSON.stringify(nodeOf(value));
}

export const cx = { notify() {} } as Context;
