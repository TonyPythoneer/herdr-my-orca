import { OFFICIAL_AGENT_KEYS } from "../../config/definitions/agent-catalog.js";

export type AgentRow = {
  key?: string;
  name?: string;
  installed?: boolean;
  run?: string[];
  tile?: string | null;
  color?: string | null;
  icon?: string | null;
  tint?: boolean;
  shell?: boolean;
  agent?: boolean;
};

export function agentWindow(
  total: number,
  start: number,
  full = 5,
): { start: number; count: number; left: boolean; right: boolean } {
  const last = Math.max(0, total - full);
  const at = Math.max(0, Math.min(start, last));
  return {
    start: at,
    count: Math.min(total - at, at < last ? full + 1 : full),
    left: at > 0,
    right: at < last,
  };
}

export function installedEnabledAgents(
  agents: AgentRow[] | null | undefined,
  disabled: Set<string>,
): AgentRow[] {
  const seen = new Set<string>();
  return (agents ?? []).filter((agent) => {
    if (
      !agent ||
      typeof agent.key !== "string" ||
      !OFFICIAL_AGENT_KEYS.has(agent.key) ||
      disabled.has(agent.key) ||
      seen.has(agent.key)
    ) {
      return false;
    }
    if (!agent.installed) return false;
    seen.add(agent.key);
    return true;
  });
}

export const offeredAgents = installedEnabledAgents;

export function freebuffVisible(detected: unknown): boolean {
  return detected === true;
}

export function freebuffRun(agents: AgentRow[] | null | undefined): string[] {
  const configured = (agents ?? []).find((agent) => agent?.key === "freebuff");
  const run = configured?.run;
  if (Array.isArray(run) && run.length && run.every((part) => typeof part === "string"))
    return [...run];
  return ["zsh", "-lic", "exec freebuff"];
}

export function emptyAgentState(officialCount: number, freebuff: boolean): boolean {
  return officialCount === 0 && !freebuff;
}

export function mergeInventory(
  known: AgentRow[] | null | undefined,
  inventory: AgentRow[] | null | undefined,
): AgentRow[] {
  if (!Array.isArray(inventory) || inventory.length === 0) return known ?? [];
  if (!Array.isArray(known) || known.length === 0) return inventory;
  const fresh = new Map(
    inventory.filter((agent) => agent?.key).map((agent) => [agent.key as string, agent]),
  );
  return known.map((agent) => {
    const current = fresh.get(agent.key as string);
    if (!current) return agent;
    const run = Array.isArray(current.run) && current.run.length ? [...current.run] : agent.run;
    return { ...agent, installed: Boolean(current.installed), run };
  });
}

export type Inventory = { at?: number; agents?: AgentRow[]; [key: string]: unknown };

export function currentInventory(inventory: unknown, now = Date.now()): Inventory | null {
  const value = inventory as Inventory | null | undefined;
  return value && Array.isArray(value.agents) && now - Number(value.at) < 120_000 ? value : null;
}
