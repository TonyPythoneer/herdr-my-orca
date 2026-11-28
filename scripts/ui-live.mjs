// Native driving of the running Herdr window for development: screenshot, OCR, click, type,
// scroll. It calls Herdr's own `herdr-app shot`/`do` and the macOS helpers already in
// ui-snapshot/ (compiled once into artifacts/ui-tools). There is no injected code and no
// alternate rendering path; the app is observed and driven exactly as a person would.
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
export const TOOL_DIR = join(ROOT, "artifacts", "ui-tools");
const SWIFT = { "screen-text": "screen-text.swift", "ax-press": "ax-press.swift" };
const WAIT_MS = 450;

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    timeout: options.timeout ?? 120000,
    ...options,
  });
  if (result.error) throw new Error(`${command}: ${result.error.message}`);
  if (result.status !== 0)
    throw new Error(
      `${command} ${args.join(" ")}: ${(result.stderr || result.stdout || "failed").trim()}`,
    );
  return result.stdout.trim();
}

// Compile a helper on first use, and again when its Swift source changed.
export function ensureTool(name) {
  const source = join(ROOT, "ui-snapshot", SWIFT[name]);
  const target = join(TOOL_DIR, name);
  const fresh = existsSync(target) && statSync(target).mtimeMs >= statSync(source).mtimeMs;
  if (fresh) return target;
  if (!existsSync(source)) throw new Error(`missing ${source}`);
  if (spawnSync("swiftc", ["--version"], { encoding: "utf8" }).status !== 0) {
    throw new Error(
      "swiftc is missing; install the Xcode command line tools to use live UI commands",
    );
  }
  mkdirSync(TOOL_DIR, { recursive: true });
  const build = spawnSync("swiftc", ["-O", source, "-o", target], {
    encoding: "utf8",
    timeout: 180000,
  });
  if (build.status !== 0)
    throw new Error(`compiling ${name} failed: ${(build.stderr || "").trim()}`);
  return target;
}

export function appPid() {
  for (const args of [
    ["-x", "Herdr"],
    ["-f", "Herdr.app/Contents/MacOS/Herdr"],
  ]) {
    const result = spawnSync("pgrep", args, { encoding: "utf8" });
    const pid = Number((result.stdout || "").trim().split(/\s+/)[0]);
    if (Number.isInteger(pid) && pid > 0) return pid;
  }
  throw new Error("Herdr is not running; start it with `herdr-app` first");
}

export function appDo(args) {
  const out = run("herdr-app", ["do", ...args]);
  try {
    return JSON.parse(out);
  } catch {
    return out;
  }
}

export function appStatus() {
  return JSON.parse(run("herdr-app", ["status"]));
}

export function capture(path) {
  ensureTool("screen-text");
  mkdirSync(dirname(path), { recursive: true });
  run("herdr-app", ["shot", path]);
  return path;
}

export function imageSize(path) {
  const head = readFileSync(path).subarray(0, 24);
  return [head.readUInt32BE(16), head.readUInt32BE(20)];
}

export function windowBounds(pid) {
  const out = run(ensureTool("ax-press"), [String(pid), "--bounds"]);
  const bounds = JSON.parse(out);
  if (!Array.isArray(bounds) || bounds.length !== 2) throw new Error(`bad window bounds: ${out}`);
  return bounds;
}

// A second Herdr instance would otherwise pair its screenshot with the first one's geometry.
export function assertShotMatchesWindow(pid, path) {
  const [width, height] = imageSize(path);
  const [bw, bh] = windowBounds(pid);
  if (!bw || !bh || Math.abs(width / bw / (height / bh) - 1) > 0.03) {
    throw new Error(
      `screenshot ${width}x${height} does not match Herdr window ${bw}x${bh}; is another instance running?`,
    );
  }
}

export function ocr(path) {
  const out = run(ensureTool("screen-text"), [path]);
  return JSON.parse(out);
}

export function matchWords(rows, needle) {
  const query = normalize(needle);
  if (!query) return [];
  const matches = rows.filter(
    (row) => row.confidence >= 0.5 && normalize(row.text).includes(query),
  );
  const exact = matches.filter((row) => normalize(row.text) === query);
  const chosen = exact.length ? exact : matches;
  return chosen.sort((a, b) => a.y - b.y || a.x - b.x);
}

export function pickWord(matches, occurrence) {
  if (!matches.length) return null;
  if (matches.length === 1) return matches[0];
  if (occurrence === "top") return matches[0];
  if (occurrence === "bottom") return matches[matches.length - 1];
  throw new Error(`ambiguous text (${matches.length} matches); pass --occurrence top|bottom`);
}

export function pointOf(row) {
  return [round(row.x), round(row.y)];
}

const round = (value) => Math.round(value * 1000) / 1000;

function inputError(error) {
  const text = String(error.message || error);
  if (text.includes("not the foreground app")) {
    return new Error(
      `${text}\nThe Mac is locked or another app is in front. Unlock it and keep Herdr frontmost, or use open/shot/tree, which need no input.`,
    );
  }
  return error;
}

function withInput(fn) {
  try {
    return fn();
  } catch (error) {
    throw inputError(error);
  }
}

export function clickPoint(pid, point, bounds) {
  const [width, height] = bounds;
  const x = Math.round(point[0] * width);
  const y = Math.round(point[1] * height);
  if (x < 0 || y < 0 || x >= width || y >= height)
    throw new Error(`point ${point} is outside the window`);
  withInput(() =>
    run(ensureTool("ax-press"), [
      String(pid),
      "--click",
      String(x),
      String(y),
      String(width),
      String(height),
    ]),
  );
  return [x, y];
}

export function paste(pid, text) {
  return withInput(() => run(ensureTool("ax-press"), [String(pid), "--paste", text]));
}

export function pressKey(pid, key) {
  return withInput(() => run(ensureTool("ax-press"), [String(pid), "--key", key]));
}

export function scrollPoint(pid, point, bounds, amount) {
  const [width, height] = bounds;
  const x = Math.round(point[0] * width);
  const y = Math.round(point[1] * height);
  return withInput(() =>
    run(ensureTool("ax-press"), [
      String(pid),
      "--scroll",
      String(x),
      String(y),
      String(width),
      String(height),
      String(Math.round(amount)),
    ]),
  );
}

export function textSet(rows) {
  return new Set(rows.map((row) => normalize(row.text)).filter(Boolean));
}

export function textDiff(before, after) {
  const was = textSet(before);
  const now = textSet(after);
  return {
    added: [...now].filter((text) => !was.has(text)).slice(0, 12),
    removed: [...was].filter((text) => !now.has(text)).slice(0, 12),
  };
}

export function readingOrder(rows) {
  return [...rows].sort((a, b) => a.y - b.y || a.x - b.x);
}

export function waitForChange(ms = WAIT_MS) {
  return sleep(ms);
}

export function normalize(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
