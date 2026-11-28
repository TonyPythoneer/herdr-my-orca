import type { AsyncContext, Point } from "gpui-kit";

export type TestPane = {
  pane: string;
  tab: string;
  terminal: string | null;
  title: string;
  focused: boolean;
};
export type TestTab = { id: string; named?: boolean; name?: string; active?: boolean };
export type TestSpace = { tabs: TestTab[] };

export type TestHost = {
  panes: TestPane[];
  terminals: unknown[];
  settings: Record<string, unknown>;
  spaces: TestSpace[];
  props: Record<string, unknown> | undefined;
  theme: Record<string, string>;
  onSetShared?: (...args: unknown[]) => void;
  onOpenOverlay?: (spec: unknown) => void;
  onCloseOverlay?: (id: string) => void;
  onRun?: (...args: unknown[]) => void;
};

export const host: TestHost = {
  panes: [],
  terminals: [],
  settings: {},
  spaces: [],
  props: {},
  theme: {},
};

export function resetHost(next: Partial<TestHost> = {}): void {
  Object.assign(
    host,
    {
      panes: [],
      terminals: [],
      settings: {},
      spaces: [],
      props: {},
      theme: {},
      onSetShared: undefined,
      onOpenOverlay: undefined,
      onCloseOverlay: undefined,
      onRun: undefined,
    },
    next,
  );
}

export function herdrMock() {
  return {
    panes: () => host.panes,
    terminals: () => host.terminals,
    settings: () => host.settings,
    spaces: () => host.spaces,
    props: () => host.props,
    theme: () => host.theme,
    setShared: (...args: unknown[]) => host.onSetShared?.(...args),
    openOverlay: (spec: unknown) => host.onOpenOverlay?.(spec),
    closeOverlay: (id: string) => host.onCloseOverlay?.(id),
    run: (...args: unknown[]) => host.onRun?.(...args),
  };
}

export function asyncContext(value: object): AsyncContext {
  return value as AsyncContext;
}

export function setPointer(at: Point | null | (() => Point | null)): void {
  const read = typeof at === "function" ? at : () => at;
  Object.defineProperty(globalThis, "window", {
    value: { mouse_position: read },
    configurable: true,
    enumerable: true,
    writable: true,
  });
}

export function clearPointer(): void {
  Reflect.deleteProperty(globalThis, "window");
}
