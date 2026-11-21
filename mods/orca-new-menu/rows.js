// Pure row policy for the Start an agent menu. No herdr or gpui imports: node --test runs this
// directly. The supported catalog still comes from knownAgents(); this file only decides which
// entries are launch choices.

/** Only officially supported, installed, enabled agents; registry order is preserved. */
export function installedEnabledAgents(agents, disabled) {
  const seen = new Set();
  return (agents ?? []).filter((agent) => {
    if (!agent || typeof agent.key !== "string" || agent.key === "freebuff" || disabled.has(agent.key) || seen.has(agent.key)) {
      return false;
    }
    if (!agent.installed) return false;
    seen.add(agent.key);
    return true;
  });
}

/** Backwards-compatible name used by older callers; the policy is the same. */
export const offeredAgents = installedEnabledAgents;

/** FreeBuff is the only unofficial integration. It appears only when its executable is present. */
export function freebuffVisible(detected, agents) {
  if (detected) return true;
  return Boolean((agents ?? []).find((agent) => agent?.key === "freebuff")?.installed);
}

/** Use a configured FreeBuff launch command when there is one; otherwise the existing integration. */
export function freebuffRun(agents) {
  const configured = (agents ?? []).find((agent) => agent?.key === "freebuff");
  const run = configured?.run;
  if (Array.isArray(run) && run.length && run.every((part) => typeof part === "string")) return [...run];
  return ["zsh", "-lic", "exec freebuff"];
}

/** The agent section has exactly one row when nothing official and no FreeBuff is available. */
export function emptyAgentState(officialCount, freebuff) {
  return officialCount === 0 && !freebuff;
}

/**
 * Merge the Agent Manager's recently refreshed local inventory (installed flags and effective
 * runs) into Herdr's catalog. The catalog keeps identity, icons and order.
 */
export function mergeInventory(known, inventory) {
  if (!Array.isArray(inventory) || inventory.length === 0) return known ?? [];
  if (!Array.isArray(known) || known.length === 0) return inventory;
  const fresh = new Map(inventory.filter((agent) => agent?.key).map((agent) => [agent.key, agent]));
  return known.map((agent) => {
    const current = fresh.get(agent.key);
    if (!current) return agent;
    const run = Array.isArray(current.run) && current.run.length ? [...current.run] : agent.run;
    return { ...agent, installed: Boolean(current.installed), run };
  });
}
