#!/usr/bin/env node
// Compare two render dumps from the golden tests, so a refactor can show exactly what changed.
//
//   node scripts/golden-diff.mjs semantic <base> <now> [--key a.b.c ...] [--noid]
//       per case (or per key), the calls each element makes, compared as sets: order is ignored,
//       children are followed. Prints only the calls present on one side. --noid ignores which element
//       a call sits on, so a button that gains an id shows only its added calls.
//   node scripts/golden-diff.mjs strict <base> <now> [--key a.b.c ...]
//       the first order-sensitive difference, with the nearest element id and both call lists.
//
// A dump is any of: one JSON value; several JSON objects written back to back (GOLDEN_DUMP); or a keyed
// object (GOLDEN_FULL, or the DUMP hook in refresh.test.js). Cases are matched by index.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function parseDump(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text.split(/\n(?=\{\n)/).map((part) => JSON.parse(part.trim()));
  }
}

const isChildCall = (entry) => Array.isArray(entry) && (entry[0] === "child" || entry[0] === "children");

// Every element under `node` as a Map of "<element id> <call><args>" -> count.
export function callSet(node, out = new Map(), id = "", withIds = true) {
  if (Array.isArray(node)) {
    for (const item of node) callSet(item, out, id, withIds);
    return out;
  }
  if (!node || typeof node !== "object") return out;
  const here = (node.c ?? []).find((e) => Array.isArray(e) && e[0] === "id")?.[1]?.[0] ?? id;
  for (const entry of node.c ?? []) {
    if (!Array.isArray(entry)) continue;
    if (isChildCall(entry)) {
      callSet(entry[1], out, here, withIds);
      continue;
    }
    const call = `${entry[0]}${JSON.stringify(entry[1])}`;
    const key = withIds ? `${here} ${call}` : call;
    out.set(key, (out.get(key) ?? 0) + 1);
  }
  for (const key of Object.keys(node)) if (key !== "c") callSet(node[key], out, here, withIds);
  return out;
}

// Order-sensitive walk: the first place where two trees differ, with the element it sits on.
export function firstDifference(a, b, id = "root") {
  if (JSON.stringify(a) === JSON.stringify(b)) return null;
  if (Array.isArray(a) && Array.isArray(b)) {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const found = firstDifference(a[i], b[i], id);
      if (found) return found;
    }
    return null;
  }
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return { id, a, b };
  const here = (a.c ?? []).find((e) => e[0] === "id")?.[1]?.[0] ?? (b.c ?? []).find((e) => e[0] === "id")?.[1]?.[0] ?? id;
  if (a.n !== b.n) return { id: here, what: "node kind", a: a.n, b: b.n };
  const ca = a.c ?? [], cb = b.c ?? [];
  for (let i = 0; i < Math.max(ca.length, cb.length); i++) {
    const ea = ca[i], eb = cb[i];
    if (JSON.stringify(ea) === JSON.stringify(eb)) continue;
    if (isChildCall(ea) && isChildCall(eb) && ea[0] === eb[0]) {
      const found = firstDifference(ea[1]?.[0], eb[1]?.[0], here);
      if (found) return found;
    }
    return { id: here, what: `call #${i}`, a: JSON.stringify(ea)?.slice(0, 120), b: JSON.stringify(eb)?.slice(0, 120) };
  }
  // A keyed dump (GOLDEN_FULL, or --key flows.x) carries its data on named keys, not only on c.
  return keyDifference(a, b, here);
}

function keyDifference(a, b, id) {
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (key === "c") continue;
    const found = firstDifference(a[key], b[key], id);
    if (found) return found;
  }
  return null;
}

// Pairs of [label, value] to compare: keyed paths when given, else cases by index, else top-level keys.
export function pairs(baseValue, nowValue, keys = []) {
  if (keys.length) {
    const at = (value, path) => path.split(".").reduce((x, p) => (x == null ? x : x[p]), value);
    return keys.map((key) => [key, at(baseValue, key), at(nowValue, key)]);
  }
  const base = Array.isArray(baseValue) ? baseValue : null;
  const now = Array.isArray(nowValue) ? nowValue : null;
  if (base && now) return base.map((value, i) => [value?.name ?? `case ${i}`, value?.trees ?? value, now[i]?.trees ?? now[i]]);
  return [...new Set([...Object.keys(baseValue), ...Object.keys(nowValue)])].map((key) => [key, baseValue[key], nowValue[key]]);
}

export function semantic(label, a, b, withIds = true) {
  const setA = callSet(a, new Map(), "", withIds), setB = callSet(b, new Map(), "", withIds);
  const onlyA = [...setA.keys()].filter((k) => !setB.has(k));
  const onlyB = [...setB.keys()].filter((k) => !setA.has(k));
  return { label, same: onlyA.length === 0 && onlyB.length === 0, onlyBase: onlyA, onlyNow: onlyB };
}

export function strict(label, a, b) {
  return { label, first: firstDifference(a, b) };
}

function main(argv) {
  const [mode, baseFile, nowFile, ...rest] = argv;
  if (!["semantic", "strict"].includes(mode) || !baseFile || !nowFile) {
    console.error("usage: golden-diff.mjs <semantic|strict> <base> <now> [--key a.b.c ...]");
    return 2;
  }
  const keys = [];
  for (let i = 0; i < rest.length; i++) if (rest[i] === "--key") keys.push(rest[++i]);
  const withIds = !rest.includes("--noid");
  const rows = pairs(parseDump(readFileSync(baseFile, "utf8")), parseDump(readFileSync(nowFile, "utf8")), keys);
  let differing = 0;
  for (const [label, a, b] of rows) {
    if (mode === "semantic") {
      const r = semantic(label, a, b, withIds);
      if (r.same) continue;
      differing++;
      console.log(`\n## ${label}`);
      r.onlyBase.slice(0, 12).forEach((x) => console.log("  BASE only:", x.slice(0, 160)));
      r.onlyNow.slice(0, 12).forEach((x) => console.log("  NOW only: ", x.slice(0, 160)));
      console.log(`  (base-only ${r.onlyBase.length}, now-only ${r.onlyNow.length})`);
    } else {
      const r = strict(label, a, b);
      if (!r.first) continue;
      differing++;
      console.log(`\n## ${label}\n` + JSON.stringify(r.first, null, 1));
    }
  }
  console.log(`\n${mode}: ${differing} of ${rows.length} differ`);
  return differing ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main(process.argv.slice(2));
