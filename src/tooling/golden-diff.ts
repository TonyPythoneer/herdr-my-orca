import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Difference = { id: string; what?: string; a?: Json; b?: Json };

export function parseDump(text: string): Json {
  try {
    return JSON.parse(text) as Json;
  } catch {
    return text.split(/\n(?=\{\n)/).map((part) => JSON.parse(part.trim()) as Json);
  }
}

const isChildCall = (entry: Json | undefined): entry is Json[] =>
  Array.isArray(entry) && (entry[0] === "child" || entry[0] === "children");

function elementId(node: { [key: string]: Json }, fallback: string): string {
  const calls = node.c;
  if (!Array.isArray(calls)) return fallback;
  const id = calls.find((entry) => Array.isArray(entry) && entry[0] === "id");
  return Array.isArray(id) && Array.isArray(id[1]) && typeof id[1][0] === "string"
    ? id[1][0]
    : fallback;
}

function recordCall(entry: Json, out: Map<string, number>, id: string, withIds: boolean): void {
  if (!Array.isArray(entry)) return;
  if (isChildCall(entry)) {
    const children = entry[1];
    if (Array.isArray(children)) for (const child of children) callSet(child, out, id, withIds);
    return;
  }
  const call = `${entry[0]}${JSON.stringify(entry[1])}`;
  const key = withIds ? `${id} ${call}` : call;
  out.set(key, (out.get(key) ?? 0) + 1);
}

export function callSet(
  node: Json,
  out = new Map<string, number>(),
  id = "",
  withIds = true,
): Map<string, number> {
  if (Array.isArray(node)) {
    for (const item of node) callSet(item, out, id, withIds);
    return out;
  }
  if (!node || typeof node !== "object") return out;
  const here = elementId(node, id);
  const calls = node.c;
  if (Array.isArray(calls)) for (const entry of calls) recordCall(entry, out, here, withIds);
  for (const [key, value] of Object.entries(node))
    if (key !== "c") callSet(value, out, here, withIds);
  return out;
}

function arrayDifference(a: Json[], b: Json[], id: string): Difference | null {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const found = firstDifference(a[i], b[i], id);
    if (found) return found;
  }
  return null;
}

function callDifference(ca: Json[], cb: Json[], id: string): Difference | null {
  for (let i = 0; i < Math.max(ca.length, cb.length); i++) {
    const ea = ca[i],
      eb = cb[i];
    if (JSON.stringify(ea) === JSON.stringify(eb)) continue;
    if (isChildCall(ea) && isChildCall(eb) && ea[0] === eb[0]) {
      const childrenA = ea[1],
        childrenB = eb[1];
      if (Array.isArray(childrenA) && Array.isArray(childrenB)) {
        const found = firstDifference(childrenA, childrenB, id);
        if (found) return found;
      }
    }
    return { id, what: `call #${i}`, a: ea, b: eb };
  }
  return null;
}

function scalarDifference(a: Json | undefined, b: Json | undefined, id: string): Difference | null {
  if (Array.isArray(a) !== Array.isArray(b)) return { id, a, b };
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return { id, a, b };
  return null;
}

export function firstDifference(
  a: Json | undefined,
  b: Json | undefined,
  id = "root",
): Difference | null {
  if (JSON.stringify(a) === JSON.stringify(b)) return null;
  if (Array.isArray(a) && Array.isArray(b)) return arrayDifference(a, b, id);
  const scalar = scalarDifference(a, b, id);
  if (scalar) return scalar;
  if (
    !a ||
    !b ||
    Array.isArray(a) ||
    Array.isArray(b) ||
    typeof a !== "object" ||
    typeof b !== "object"
  )
    return { id, a, b };
  return objectDifference(a, b, id);
}

function objectDifference(
  a: { [key: string]: Json },
  b: { [key: string]: Json },
  id: string,
): Difference | null {
  const here = elementId(a, elementId(b, id));
  if (a.n !== b.n) return { id: here, what: "node kind", a: a.n, b: b.n };
  const calls = callDifference(Array.isArray(a.c) ? a.c : [], Array.isArray(b.c) ? b.c : [], here);
  return calls ?? keyDifference(a, b, here);
}

function keyDifference(
  a: { [key: string]: Json },
  b: { [key: string]: Json },
  id: string,
): Difference | null {
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (key === "c") continue;
    const found = firstDifference(a[key], b[key], id);
    if (found) return found;
  }
  return null;
}

export function pairs(
  baseValue: Json,
  nowValue: Json,
  keys: string[] = [],
): [string, Json | undefined, Json | undefined][] {
  if (keys.length)
    return keys.map((key) => [key, valueAtPath(baseValue, key), valueAtPath(nowValue, key)]);
  const base = Array.isArray(baseValue) ? baseValue : null;
  const now = Array.isArray(nowValue) ? nowValue : null;
  if (base && now) return pairArrayCases(base, now);
  return pairObjectKeys(baseValue, nowValue);
}

function valueAtPath(value: Json, path: string): Json | undefined {
  return path.split(".").reduce<Json | undefined>((current, key) => {
    if (!current || typeof current !== "object") return undefined;
    if (Array.isArray(current))
      return /^(0|[1-9]\d*)$/.test(key) ? current[Number(key)] : undefined;
    return current[key];
  }, value);
}

function pairArrayCases(base: Json[], now: Json[]): [string, Json | undefined, Json | undefined][] {
  return Array.from({ length: Math.max(base.length, now.length) }, (_, index) =>
    pairCase(base[index], now[index], index),
  );
}

function pairCase(
  before: Json | undefined,
  after: Json | undefined,
  index: number,
): [string, Json | undefined, Json | undefined] {
  const beforeCase = caseFields(before);
  const afterCase = caseFields(after);
  const label = beforeCase?.name ?? afterCase?.name ?? `case ${index}`;
  return [String(label), beforeCase?.trees ?? before, afterCase?.trees ?? after];
}

function caseFields(
  value: Json | undefined,
): { name: Json | undefined; trees: Json | undefined } | undefined {
  if (!value || Array.isArray(value) || typeof value !== "object") return undefined;
  return { name: value.name, trees: value.trees };
}

function pairObjectKeys(base: Json, now: Json): [string, Json | undefined, Json | undefined][] {
  if (
    !base ||
    Array.isArray(base) ||
    typeof base !== "object" ||
    !now ||
    Array.isArray(now) ||
    typeof now !== "object"
  )
    return [];
  return [...new Set([...Object.keys(base), ...Object.keys(now)])].map((key) => [
    key,
    base[key],
    now[key],
  ]);
}

export function semantic(
  label: string,
  a: Json | undefined,
  b: Json | undefined,
  withIds = true,
): { label: string; same: boolean; onlyBase: string[]; onlyNow: string[] } {
  const setA = a === undefined ? new Map<string, number>() : callSet(a, new Map(), "", withIds);
  const setB = b === undefined ? new Map<string, number>() : callSet(b, new Map(), "", withIds);
  const onlyA = [...setA.keys()].filter((key) => !setB.has(key));
  const onlyB = [...setB.keys()].filter((key) => !setA.has(key));
  return { label, same: onlyA.length === 0 && onlyB.length === 0, onlyBase: onlyA, onlyNow: onlyB };
}

export function strict(
  label: string,
  a: Json | undefined,
  b: Json | undefined,
): { label: string; first: Difference | null } {
  return { label, first: firstDifference(a, b) };
}

type Invocation = {
  mode: "semantic" | "strict";
  baseFile: string;
  nowFile: string;
  keys: string[];
  withIds: boolean;
};

export function parseInvocation(argv: string[]): Invocation | null {
  const [mode, baseFile, nowFile, ...rest] = argv;
  if ((mode !== "semantic" && mode !== "strict") || !baseFile || !nowFile) return null;
  const keys: string[] = [];
  for (let i = 0; i < rest.length; i++)
    if (rest[i] === "--key" && rest[i + 1]) keys.push(rest[++i]);
  return { mode, baseFile, nowFile, keys, withIds: !rest.includes("--noid") };
}

function runSemantic(
  label: string,
  a: Json | undefined,
  b: Json | undefined,
  withIds: boolean,
): boolean {
  const result = semantic(label, a, b, withIds);
  if (result.same) return false;
  console.log(`\n## ${label}`);
  result.onlyBase.slice(0, 12).forEach((entry) => console.log("  BASE only:", entry.slice(0, 160)));
  result.onlyNow.slice(0, 12).forEach((entry) => console.log("  NOW only: ", entry.slice(0, 160)));
  console.log(`  (base-only ${result.onlyBase.length}, now-only ${result.onlyNow.length})`);
  return true;
}

function runStrict(label: string, a: Json | undefined, b: Json | undefined): boolean {
  const result = strict(label, a, b);
  if (!result.first) return false;
  console.log(`\n## ${label}\n` + JSON.stringify(result.first, null, 1));
  return true;
}

export function runGoldenDiff(argv: string[]): number {
  const invocation = parseInvocation(argv);
  if (!invocation) {
    console.error(
      "usage: vpx src/tooling/golden-diff.ts <semantic|strict> <base> <now> [--key a.b.c ...]",
    );
    return 2;
  }
  const { mode, baseFile, nowFile, keys, withIds } = invocation;
  const rows = pairs(
    parseDump(readFileSync(baseFile, "utf8")),
    parseDump(readFileSync(nowFile, "utf8")),
    keys,
  );
  let differing = 0;
  for (const [label, a, b] of rows) {
    if (mode === "semantic" ? runSemantic(label, a, b, withIds) : runStrict(label, a, b))
      differing++;
  }
  console.log(`\n${mode}: ${differing} of ${rows.length} differ`);
  return differing ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  process.exitCode = runGoldenDiff(process.argv.slice(2));
