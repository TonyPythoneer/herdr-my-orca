import { isRecord, type UsageReading } from "./usage.js";

const HOUR = 60 * 60 * 1000;

type GatewayEvent = {
  provider: string;
  model: string;
  timestamp: number;
  id: unknown;
  kilo: boolean;
};
type GatewayRow = { count: number; free: number; sawFree: boolean; kilo: boolean; name: string };

function parseGatewayEvent(line: string, now: number): GatewayEvent | null {
  let event: unknown;
  try {
    event = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isRecord(event) || event.version !== 1 || event.kind !== "attempt") return null;
  const { provider, model, timestamp } = event;
  if (
    typeof provider !== "string" ||
    typeof model !== "string" ||
    typeof timestamp !== "number" ||
    !Number.isFinite(timestamp) ||
    timestamp > now
  )
    return null;
  return { provider, model, timestamp, id: event.id, kilo: Boolean(event.kilo) };
}

function addGatewayEvent(
  byProvider: Map<string, GatewayRow>,
  seen: Set<string>,
  event: GatewayEvent,
  now: number,
): void {
  const id = JSON.stringify([event.provider, event.id, event.model]);
  if (seen.has(id)) return;
  seen.add(id);
  const key = event.kilo ? "kilo" : "gateway:" + event.provider;
  const current = byProvider.get(key) ?? {
    count: 0,
    free: 0,
    sawFree: false,
    kilo: event.kilo,
    name: event.provider,
  };
  const free = event.kilo && /(?:\/free|:free)$/i.test(event.model);
  if (free) current.sawFree = true;
  if (event.timestamp > now - HOUR) {
    current.count++;
    if (free) current.free++;
  }
  byProvider.set(key, current);
}

function gatewayRow(key: string, row: GatewayRow): UsageReading {
  return {
    provider: row.kilo ? "kilo" : row.name,
    gatewayKey: key,
    status: "ok",
    label: "",
    detail: true,
    buckets: [],
    text: row.kilo ? "~" + row.free + "/200 1h" : row.count + " req 1h",
    tooltip: row.kilo
      ? "Estimated local free-model deployment attempts in the last 60 minutes; excludes other clients and may include failed attempts."
      : "Local gateway deployment attempts in the last 60 minutes.",
  };
}

export function gatewayReadings(
  texts: (string | null)[],
  now: number = Date.now(),
): UsageReading[] {
  const byProvider = new Map<string, GatewayRow>();
  const seen = new Set<string>();
  for (const text of texts)
    for (const line of String(text ?? "").split("\n")) {
      const event = parseGatewayEvent(line, now);
      if (event) addGatewayEvent(byProvider, seen, event, now);
    }
  return [...byProvider.entries()]
    .filter(([, row]) => !row.kilo || row.sawFree)
    .map(([key, row]) => gatewayRow(key, row));
}
