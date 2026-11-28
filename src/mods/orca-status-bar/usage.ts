export type ExecResult = { code: number; stdout: string };
export type ExecFn = (
  command: string,
  args: string[],
  options?: { timeout?: number },
) => Promise<ExecResult>;
export type UsageStatus = "ok" | "error" | "unavailable";
export type UsageBucket = {
  id?: string;
  name?: string;
  label?: string;
  group?: string;
  window?: string;
  windowMinutes: number;
  usedPercent: number;
  remainingFraction?: number;
  resetTime?: string | null;
  idleText?: string;
};
export type UsageReading = {
  provider: string;
  status: UsageStatus;
  label: string;
  buckets: UsageBucket[];
  detail?: boolean;
  text?: string;
  resetTime?: string | null;
  tooltip?: string;
  gatewayKey?: string;
};

const WEEKLY_WINDOW_MINUTES = 10080;
const SESSION_WINDOW_MINUTES = 300;
const MINUTE_MS = 60000;

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const field = (value: unknown, key: string): unknown => (isRecord(value) ? value[key] : undefined);

const raw = <T>(value: unknown, fallback: T): T => (value ?? fallback) as T;

export function clampUsedPercent(pct: unknown): number {
  if (typeof pct !== "number" || Number.isNaN(pct)) return 0;
  return Math.min(100, Math.max(0, Math.round(pct)));
}

export function windowMinutesFor(window: unknown): number | null {
  if (window === "weekly") return WEEKLY_WINDOW_MINUTES;
  if (window === "5h") return SESSION_WINDOW_MINUTES;
  return null;
}

export function shortenGroup(group: unknown): string {
  if (!group || typeof group !== "string") return "";
  const short = group
    .replace(/\s+models$/i, "")
    .replace(/\s+and\s+/gi, "/")
    .trim();
  return short || group;
}

export function formatWindowLabel(windowMinutes: number): string {
  if (windowMinutes === 10080) return "wk";
  if (windowMinutes === 300) return "5h";
  if (windowMinutes === 60) return "1h";
  if (windowMinutes < 60) return `${windowMinutes}m`;
  if (windowMinutes % (60 * 24 * 7) === 0) return `${windowMinutes / (60 * 24 * 7)}wk`;
  if (windowMinutes % (60 * 24) === 0) return `${windowMinutes / (60 * 24)}d`;
  if (windowMinutes % 60 === 0) return `${windowMinutes / 60}h`;
  return `${windowMinutes}m`;
}

type PoolWindow = { windowMinutes: number; name?: string };

export function formatPoolWindowName(bucket: PoolWindow): string {
  if (bucket.windowMinutes > 0) {
    if (bucket.windowMinutes === WEEKLY_WINDOW_MINUTES) return "wk";
    return formatWindowLabel(bucket.windowMinutes);
  }
  return (bucket.name ?? "").replace(/\s*limit remaining$/i, "").trim();
}

export function formatPoolShortLabel(groupName: string, bucket: PoolWindow): string {
  const groupLabel = shortenGroup(groupName);
  const windowLabel = formatPoolWindowName(bucket);
  return `${groupLabel} ${windowLabel}`.trim();
}

function antigravityBucket(group: string, b: unknown, fraction: number): UsageBucket {
  const window = raw(field(b, "window"), "");
  return {
    id: raw(field(b, "id"), ""),
    group,
    name: raw(field(b, "name"), ""),
    window,
    windowMinutes: windowMinutesFor(window) ?? 0,
    remainingFraction: fraction,
    usedPercent: clampUsedPercent((1 - fraction) * 100),
    resetTime: raw(field(b, "reset_time"), null),
  };
}

function antigravityGroupBuckets(group: unknown): UsageBucket[] {
  const name = field(group, "name");
  const buckets = field(group, "buckets");
  if (typeof name !== "string" || !Array.isArray(buckets)) return [];
  return buckets.flatMap((b) => {
    const fraction = field(b, "remaining_fraction");
    return typeof fraction === "number" ? [antigravityBucket(name, b, fraction)] : [];
  });
}

export function parseAntigravityOutput(stdout: unknown): { buckets: UsageBucket[] } | null {
  if (!stdout || typeof stdout !== "string") return null;
  try {
    const groups = field(field(field(JSON.parse(stdout), "command"), "data"), "groups");
    if (!Array.isArray(groups) || groups.length === 0) return null;
    const buckets = groups.flatMap(antigravityGroupBuckets);
    return buckets.length > 0 ? { buckets } : null;
  } catch {
    return null;
  }
}

export function getTightestUsageBucket(buckets: UsageBucket[]): UsageBucket | null {
  if (!Array.isArray(buckets) || buckets.length === 0) return null;
  let tightest: UsageBucket | null = null;
  for (const bucket of buckets) {
    if (!tightest || bucket.usedPercent > tightest.usedPercent) {
      tightest = bucket;
    }
  }
  return tightest;
}

export function formatBucketChipLabel(bucket: UsageBucket): string {
  return bucket.group ? formatPoolShortLabel(bucket.group, bucket) : formatPoolWindowName(bucket);
}

function parseOmpEnvelope(stdout: string): unknown {
  const start = stdout.indexOf("{");
  const end = stdout.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(stdout.slice(start, end + 1));
  } catch {
    return null;
  }
}

const windowMinutesOf = (durationMs: unknown): number =>
  typeof durationMs === "number" && durationMs > 0 ? Math.round(durationMs / MINUTE_MS) : 0;

function ompBucket(limit: unknown): UsageBucket | null {
  const fraction = field(field(limit, "amount"), "usedFraction");
  if (typeof fraction !== "number" || !Number.isFinite(fraction)) return null;
  const window = field(limit, "window");
  const label = field(window, "label") ?? field(limit, "label");
  return {
    id: raw(field(limit, "id"), ""),
    name: raw(label, ""),
    windowMinutes: windowMinutesOf(field(window, "durationMs")),
    usedPercent: clampUsedPercent(fraction * 100),
    resetTime: raw(field(window, "resetsAt"), null),
  };
}

const isBucket = (bucket: UsageBucket | null): bucket is UsageBucket => bucket !== null;
const isReading = (reading: UsageReading | null): reading is UsageReading => reading !== null;

function ompReading(report: unknown): UsageReading | null {
  const provider = field(report, "provider");
  if (typeof provider !== "string") return null;
  const limits = field(report, "limits");
  const buckets = (Array.isArray(limits) ? limits : []).map(ompBucket).filter(isBucket);
  return { provider, status: buckets.length > 0 ? "ok" : "unavailable", label: "", buckets };
}

export function parseOmpUsage(stdout: unknown): UsageReading[] | null {
  if (!stdout || typeof stdout !== "string") return null;
  const reports = field(parseOmpEnvelope(stdout), "reports");
  if (!Array.isArray(reports)) return null;
  const readings = reports.map(ompReading).filter(isReading);
  return readings.length > 0 ? readings : null;
}

const INSTALL_DIRS = [
  ".bun/bin",
  ".local/bin",
  ".volta/bin",
  ".asdf/shims",
  ".local/share/mise/shims",
  ".local/share/pnpm",
  ".yarn/bin",
  "Library/pnpm",
];

async function runCommand(
  execFn: ExecFn,
  homeDir: string | null,
  command: string,
  args: string[],
  timeout: number,
): Promise<ExecResult> {
  const programs = homeDir
    ? [command, ...INSTALL_DIRS.map((dir) => `${homeDir}/${dir}/${command}`)]
    : [command];
  let first: unknown;
  for (const program of programs) {
    try {
      return await execFn(program, args, { timeout });
    } catch (error) {
      first ??= error;
    }
  }
  throw first;
}

export async function probeAntigravity(
  execFn: ExecFn,
  homeDir: string | null = null,
): Promise<UsageReading> {
  try {
    const res = await runCommand(
      execFn,
      homeDir,
      "agy",
      ["-p", "/usage", "--output-format", "json", "--print-timeout", "20s"],
      25000,
    );
    if (res.code === 0 && res.stdout) {
      const parsed = parseAntigravityOutput(res.stdout);
      if (parsed) {
        return { provider: "antigravity", status: "ok", label: "", buckets: parsed.buckets };
      }
    }
  } catch {}
  return { provider: "antigravity", status: "error", label: "Refresh failed", buckets: [] };
}

export async function probeOmp(
  execFn: ExecFn,
  homeDir: string | null = null,
): Promise<UsageReading[]> {
  try {
    const res = await runCommand(execFn, homeDir, "omp", ["usage", "--json"], 60000);
    if (res.code === 0 && res.stdout) {
      return parseOmpUsage(res.stdout) ?? [];
    }
  } catch {}
  return [];
}

export async function probeAllProviders(deps?: {
  exec?: ExecFn;
  home?: string | null;
}): Promise<{ providers: UsageReading[] }> {
  const execFn: ExecFn = deps?.exec ?? (async () => ({ code: 1, stdout: "" }));
  const homeDir = deps?.home ?? null;

  const [antigravity, omp] = await Promise.all([
    probeAntigravity(execFn, homeDir),
    probeOmp(execFn, homeDir),
  ]);
  return { providers: [antigravity, ...omp] };
}
