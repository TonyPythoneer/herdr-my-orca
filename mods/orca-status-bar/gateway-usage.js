// Local observation, not an authoritative provider quota.
const HOUR = 60 * 60 * 1000;
function parseGatewayEvent(line, now) {
  let event;
  try { event = JSON.parse(line); } catch { return null; }
  if (event?.version !== 1 || event.kind !== "attempt" || typeof event.provider !== "string" ||
      typeof event.model !== "string" || !Number.isFinite(event.timestamp) || event.timestamp > now) return null;
  return event;
}

function addGatewayEvent(byProvider, seen, event, now) {
  const id = JSON.stringify([event.provider, event.id, event.model]);
  if (seen.has(id)) return;
  seen.add(id);
  const key = event.kilo ? "kilo" : "gateway:" + event.provider;
  const current = byProvider.get(key) ?? { count: 0, free: 0, sawFree: false, kilo: event.kilo, name: event.provider };
  const free = event.kilo && /(?:\/free|:free)$/i.test(event.model);
  if (free) current.sawFree = true;
  if (event.timestamp > now - HOUR) {
    current.count++;
    if (free) current.free++;
  }
  byProvider.set(key, current);
}

function gatewayRow(key, row) {
  return {
    provider: row.kilo ? "kilo" : row.name, gatewayKey: key, status: "ok", detail: true, buckets: [],
    text: row.kilo ? "~" + row.free + "/200 1h" : row.count + " req 1h",
    tooltip: row.kilo ? "Estimated local free-model deployment attempts in the last 60 minutes; excludes other clients and may include failed attempts." : "Local gateway deployment attempts in the last 60 minutes."
  };
}

export function gatewayReadings(texts, now = Date.now()) {
  const byProvider = new Map();
  const seen = new Set();
  for (const text of texts) for (const line of String(text ?? "").split("\n")) {
    const event = parseGatewayEvent(line, now);
    if (event) addGatewayEvent(byProvider, seen, event, now);
  }
  return [...byProvider.entries()].filter(([, row]) => !row.kilo || row.sawFree).map(([key, row]) => gatewayRow(key, row));
}
