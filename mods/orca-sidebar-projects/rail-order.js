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

// The order while an icon is dragged: `key` moves to slot `target`; the others keep their order.
export function moveInOrder(base, key, target) {
  if (!base.includes(key)) return base.slice();
  const rest = base.filter(item => item !== key);
  rest.splice(Math.max(0, Math.min(target, rest.length)), 0, key);
  return rest;
}

// The slot under the pointer. `pressOffset` is where the icon was grabbed inside its own row.
export function dragSlot(pointerY, pressOffset, rowHeight, count) {
  const slot = Math.floor((pointerY - pressOffset + rowHeight / 2) / rowHeight);
  return Math.max(0, Math.min(count - 1, slot));
}
