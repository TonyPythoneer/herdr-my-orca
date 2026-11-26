// Local observation, not an authoritative provider quota.
const HOUR = 60 * 60 * 1000;
export function gatewayReadings(texts, now = Date.now()) {
  const byProvider = new Map();
  const seen = new Set();
  for (const text of texts) for (const line of String(text ?? "").split("\n")) {
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    if (event?.version !== 1 || event.kind !== "attempt" || typeof event.provider !== "string" ||
        typeof event.model !== "string" || !Number.isFinite(event.timestamp) || event.timestamp > now) continue;
    const id = JSON.stringify([event.provider, event.id, event.model]);
    if (seen.has(id)) continue;
    seen.add(id);
    const key = event.kilo ? "kilo" : "gateway:" + event.provider;
    const current = byProvider.get(key) ?? { count: 0, free: 0, kilo: event.kilo, name: event.provider };
    if (event.timestamp > now - HOUR) {
      current.count++;
      if (event.kilo && /(?:[:/]|-)free$/i.test(event.model)) current.free++;
    }
    byProvider.set(key, current);
  }
  return [...byProvider.entries()].map(([key, row]) => ({
    provider: row.kilo ? "kilo" : row.name, gatewayKey: key, status: "ok", detail: true, buckets: [],
    text: row.kilo ? "~" + row.free + "/200 1h" : row.count + " req 1h",
    tooltip: row.kilo ? "Estimated local free-model deployment attempts in the last 60 minutes; excludes other clients and may include failed attempts." : "Local gateway deployment attempts in the last 60 minutes."
  }));
}
