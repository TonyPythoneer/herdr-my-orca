// Pure row policy for the Orca menu. No herdr or gpui imports: node --test runs this directly.

/** Agents the person has not disabled. A missing/duplicate entry never becomes a row. */
export function offeredAgents(agents, disabled) {
  const seen = new Set();
  return (agents ?? []).filter((agent) => {
    if (!agent || typeof agent.key !== "string" || disabled.has(agent.key) || seen.has(agent.key)) {
      return false;
    }
    seen.add(agent.key);
    return true;
  });
}

/** freebuff is a static unofficial row only when no configured freebuff row already exists. */
export function showStaticFreebuff(agents, disabled, ready) {
  return Boolean(ready) && !disabled.has("freebuff") && !(agents ?? []).some((agent) => agent?.key === "freebuff");
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
