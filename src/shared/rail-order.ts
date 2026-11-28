import { shared, setShared } from "herdr";

export const RAIL_ORDER_KEY = "rail.order";

export type RailOrder = {
  unofficial: string[];
  providers: string[];
};

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item): item is string => typeof item === "string");
}

export function readRailOrder(): RailOrder {
  const raw = shared(RAIL_ORDER_KEY);
  const record =
    raw !== null && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  return {
    unofficial: isStringArray(record.unofficial) ? [...record.unofficial] : [],
    providers: isStringArray(record.providers) ? [...record.providers] : [],
  };
}

export function persistRailOrder(order: RailOrder): void {
  setShared(RAIL_ORDER_KEY, order);
}

export function applyRailOrder<T>(
  list: readonly T[],
  order: readonly string[],
  keyOf: (item: T) => string,
): T[] {
  const byKey = new Map<string, T>();
  for (const item of list) byKey.set(keyOf(item), item);
  const ordered: T[] = [];
  const seen = new Set<string>();
  for (const key of order) {
    const item = byKey.get(key);
    if (item && !seen.has(key)) {
      ordered.push(item);
      seen.add(key);
    }
  }
  for (const item of list) {
    if (!seen.has(keyOf(item))) {
      ordered.push(item);
      seen.add(keyOf(item));
    }
  }
  return ordered;
}

export function swapOrderIds(order: readonly string[], a: string, b: string): string[] {
  const next = order.slice();
  if (a === b) return next;
  const ai = next.indexOf(a);
  const bi = next.indexOf(b);
  if (ai < 0 || bi < 0) return next;
  next[ai] = b;
  next[bi] = a;
  return next;
}
