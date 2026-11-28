// The rail's saved swap order, Herdr shared key `rail.order`: { unofficial: [agent keys], providers: [provider ids] }.
// Same logic as src/shared/rail-order.ts; a copy lives here because a mod may import only its own folder.
import { setShared, shared } from "herdr";

export const RAIL_ORDER_KEY = "rail.order";

function isStringArray(value) {
  return Array.isArray(value) && value.every(item => typeof item === "string");
}

export function readRailOrder() {
  const raw = shared(RAIL_ORDER_KEY);
  const record = raw !== null && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  return {
    unofficial: isStringArray(record.unofficial) ? [...record.unofficial] : [],
    providers: isStringArray(record.providers) ? [...record.providers] : [],
  };
}

export function persistRailOrder(order) {
  setShared(RAIL_ORDER_KEY, order);
}

// Saved keys first, in saved order; anything not saved keeps its current place after them.
export function applyRailOrder(list, order, keyOf) {
  const byKey = new Map();
  for (const item of list) byKey.set(keyOf(item), item);
  const ordered = [];
  const seen = new Set();
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

export function swapOrderIds(order, a, b) {
  const next = order.slice();
  if (a === b) return next;
  const ai = next.indexOf(a);
  const bi = next.indexOf(b);
  if (ai < 0 || bi < 0) return next;
  next[ai] = b;
  next[bi] = a;
  return next;
}

// Drag to swap: the icon pressed (`from`) takes the place of the one released on (`to`) in `base`,
// the order on screen. Returns the new order, or null when nothing moves.
export function dragSwapOrder(base, from, to) {
  if (!from || from === to) return null;
  const next = swapOrderIds(base, from, to);
  return next.every((key, i) => key === base[i]) ? null : next;
}
