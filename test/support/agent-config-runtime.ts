export type AgentConfigWorld = {
  key: string;
  argv: string[];
  files?: Record<string, string>;
  exec?: Record<string, unknown>;
  checking?: boolean;
  machine?: string;
  launchNow?: boolean;
  dark?: boolean;
  managerCopy?: boolean;
};

export type AgentConfigContext = {
  notify(): void;
  spawn(job: (cx: AgentConfigContext) => unknown): void;
  timer: { after(ms: number, callback: () => void): void };
  stop_propagation(): void;
};

export type AgentConfigHandler = [string, (...args: unknown[]) => unknown, string?];
export type AgentConfigRuntime = {
  world: AgentConfigWorld;
  log: unknown[][];
  files: Map<string, string>;
  handlers: AgentConfigHandler[];
  jobs: Array<(cx: AgentConfigContext) => unknown>;
  timers: Array<[number, () => void]>;
};

let current: AgentConfigRuntime | null = null;

export function setAgentConfigRuntime(
  world: AgentConfigWorld,
  log: unknown[][] = [],
): AgentConfigRuntime {
  current = {
    world,
    log,
    files: new Map(Object.entries(world.files ?? {})),
    handlers: [],
    jobs: [],
    timers: [],
  };
  return current;
}

export function agentConfigRuntime(): AgentConfigRuntime | null {
  return current;
}

export function clearAgentConfigRuntime(): void {
  current = null;
}
