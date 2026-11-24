// Portions ported from Orca (MIT, Copyright (c) 2026 Lovecast Inc.); see NOTICE.
// Ported from:
// - src/main/rate-limits/antigravity-usage-response.ts
// - src/main/rate-limits/antigravity-usage-command.ts
// - src/renderer/src/components/status-bar/UsageRosterPanel.tsx
// - src/renderer/src/components/status-bar/status-bar-usage-sections.ts
// - src/renderer/src/components/status-bar/usage-pool-label.ts
// - src/shared/rate-limit-window-label.ts
//
// One reading shape for every quota source, because Orca has one
// (`ProviderRateLimits`, src/shared/rate-limit-types.ts:91-127): a provider, a status, and
// the pools its plan meters. A source that cannot produce a percentage produces no chip: a
// mark with no number beside it claims a reading that never happened (UsageRosterPanel.tsx,
// where an unconfigured provider leaves the roster entirely).
//
// Orca's own quota sources are absent here on purpose. Each is a signed HTTP call built on an
// account store this package does not have: Claude reads its OAuth credentials file
// (claude-oauth-credentials.ts:30-40) and GETs api.anthropic.com/api/oauth/usage
// (claude-oauth-usage-request.ts:19,49-56), Codex sends stored bearer headers to
// chatgpt.com/backend-api/wham/usage (codex-backend-usage-client.ts:69). Neither can be
// verified from a mod here, and an unverified fetch is a chip that may be permanently wrong.
// `omp usage --json` covers the same providers for anyone signed in through OMP, with no
// headers of our own.

const WEEKLY_WINDOW_MINUTES = 10080;
const SESSION_WINDOW_MINUTES = 300;
const MINUTE_MS = 60000;

export function clampUsedPercent(pct) {
  if (typeof pct !== 'number' || Number.isNaN(pct)) return 0;
  return Math.min(100, Math.max(0, Math.round(pct)));
}

export function windowMinutesFor(window) {
  if (window === 'weekly') return WEEKLY_WINDOW_MINUTES;
  if (window === '5h') return SESSION_WINDOW_MINUTES;
  return null;
}

export function shortenGroup(group) {
  if (!group || typeof group !== 'string') return '';
  const short = group
    .replace(/\s+models$/i, '')
    .replace(/\s+and\s+/gi, '/')
    .trim();
  return short || group;
}

export function formatWindowLabel(windowMinutes) {
  if (windowMinutes === 10080) return 'wk';
  if (windowMinutes === 300) return '5h';
  if (windowMinutes === 60) return '1h';
  if (windowMinutes < 60) return `${windowMinutes}m`;
  if (windowMinutes % (60 * 24 * 7) === 0) return `${windowMinutes / (60 * 24 * 7)}wk`;
  if (windowMinutes % (60 * 24) === 0) return `${windowMinutes / (60 * 24)}d`;
  if (windowMinutes % 60 === 0) return `${windowMinutes / 60}h`;
  return `${windowMinutes}m`;
}

/** A window with no known length names itself; `formatWindowLabel(0)` would invent "0m". */
export function formatPoolWindowName(bucket) {
  if (bucket.windowMinutes > 0) {
    if (bucket.windowMinutes === WEEKLY_WINDOW_MINUTES) return 'wk';
    return formatWindowLabel(bucket.windowMinutes);
  }
  return (bucket.name ?? '').replace(/\s*limit remaining$/i, '').trim();
}

export function formatPoolShortLabel(groupName, bucket) {
  const groupLabel = shortenGroup(groupName);
  const windowLabel = formatPoolWindowName(bucket);
  return `${groupLabel} ${windowLabel}`.trim();
}

// Flat buckets carrying their pool name, as Orca's parser returns them
// (antigravity-usage-response.ts:96-130): `group` is a field, not a nesting level,
// because only Antigravity groups pools; every other provider's windows are flat.
function antigravityGroupBuckets(group) {
  if (!group || typeof group.name !== 'string' || !Array.isArray(group.buckets)) return [];
  return group.buckets
    .filter((b) => b && typeof b.remaining_fraction === 'number')
    .map((b) => ({
      id: b.id ?? '',
      group: group.name,
      name: b.name ?? '',
      window: b.window ?? '',
      windowMinutes: windowMinutesFor(b.window) ?? 0,
      remainingFraction: b.remaining_fraction,
      usedPercent: clampUsedPercent((1 - b.remaining_fraction) * 100),
      resetTime: b.reset_time ?? null
    }));
}

export function parseAntigravityOutput(stdout) {
  if (!stdout || typeof stdout !== 'string') return null;
  try {
    const groups = JSON.parse(stdout)?.command?.data?.groups;
    if (!Array.isArray(groups) || groups.length === 0) return null;
    const buckets = groups.flatMap(antigravityGroupBuckets);
    return buckets.length > 0 ? { buckets } : null;
  } catch {
    return null;
  }
}

/** The highest-consumed bucket, ranked on consumption even when the display means remaining. */
export function getTightestUsageBucket(buckets) {
  if (!Array.isArray(buckets) || buckets.length === 0) return null;
  let tightest = null;
  for (const bucket of buckets) {
    if (!tightest || bucket.usedPercent > tightest.usedPercent) {
      tightest = bucket;
    }
  }
  return tightest;
}

/**
 * A bucket's chip label. Only a grouped pool names its group, because "Gemini wk" and
 * "Claude/GPT wk" are two windows of one provider; an ungrouped bucket is just its window
 * (`status-bar-usage-sections.ts:39-51`, whose label for a plain window is the window).
 */
export function formatBucketChipLabel(bucket) {
  return bucket.group
    ? formatPoolShortLabel(bucket.group, bucket)
    : formatPoolWindowName(bucket);
}

/** The outermost `{...}` of OMP's output, parsed; null when there is none or it is not JSON. */
function parseOmpEnvelope(stdout) {
  const start = stdout.indexOf('{');
  const end = stdout.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(stdout.slice(start, end + 1));
  } catch {
    return null;
  }
}

const windowMinutesOf = (durationMs) =>
  typeof durationMs === 'number' && durationMs > 0 ? Math.round(durationMs / MINUTE_MS) : 0;

// A balance row carries no window and no fraction, so it never becomes a bucket.
function ompBucket(limit) {
  const fraction = limit?.amount?.usedFraction;
  if (typeof fraction !== 'number' || !Number.isFinite(fraction)) return null;
  return {
    id: limit.id ?? '',
    name: limit.window?.label ?? limit.label ?? '',
    windowMinutes: windowMinutesOf(limit.window?.durationMs),
    usedPercent: clampUsedPercent(fraction * 100),
    resetTime: limit.window?.resetsAt ?? null
  };
}

// A provider is one pool: OMP meters the provider as a whole, so its buckets carry no
// `group`, and the chip reads "5h" rather than repeating the provider beside its own mark.
function ompReading(report) {
  const provider = report?.provider;
  if (typeof provider !== 'string') return null;
  const buckets = (Array.isArray(report.limits) ? report.limits : []).map(ompBucket).filter(Boolean);
  return { provider, status: buckets.length > 0 ? 'ok' : 'unavailable', label: '', buckets };
}

/**
 * `omp usage --json` as Orca-shaped readings: one per provider OMP has an account for,
 * its metered windows as buckets. OMP prints update notices before the envelope
 * (omp-model-list-probe.ts:7-27), so the payload is the outermost object.
 */
export function parseOmpUsage(stdout) {
  if (!stdout || typeof stdout !== 'string') return null;
  const data = parseOmpEnvelope(stdout);
  if (!Array.isArray(data?.reports)) return null;
  const readings = data.reports.map(ompReading).filter(Boolean);
  return readings.length > 0 ? readings : null;
}

// The app's own PATH is not the login shell's: `omp` installs to ~/.bun/bin, which a desktop
// launch misses, so a bare `exec("omp", …)` fails while `agy` (in ~/.local/bin) works. Orca
// resolves a CLI through PATH, then the version-manager bins a GUI launch misses
// (node-cli-command-resolution.ts:123-140). Same list the create menu's model probe uses, which
// hit this first; a CLI installed elsewhere needs its folder added here.
const INSTALL_DIRS = [
  ".bun/bin",
  ".local/bin",
  ".volta/bin",
  ".asdf/shims",
  ".local/share/mise/shims",
  ".local/share/pnpm",
  ".yarn/bin",
  "Library/pnpm"
];

/** Runs `command` as the login shell would find it; rejects only when nothing starts. */
async function runCommand(execFn, homeDir, command, args, timeout) {
  const programs = homeDir
    ? [command, ...INSTALL_DIRS.map((dir) => `${homeDir}/${dir}/${command}`)]
    : [command];
  let first;
  for (const program of programs) {
    try {
      return await execFn(program, args, { timeout });
    } catch (error) {
      first ??= error;
    }
  }
  throw first;
}

export async function probeAntigravity(execFn, homeDir) {
  try {
    const res = await runCommand(
      execFn,
      homeDir,
      'agy',
      ['-p', '/usage', '--output-format', 'json', '--print-timeout', '20s'],
      25000
    );
    if (res && res.code === 0 && res.stdout) {
      const parsed = parseAntigravityOutput(res.stdout);
      if (parsed) {
        return {
          provider: 'antigravity',
          status: 'ok',
          label: '',
          buckets: parsed.buckets
        };
      }
    }
  } catch {
    // Falls through to error status
  }
  // getProviderUsageStatusLabel()'s fallback copy (usage-error-copy.ts:131)
  return { provider: 'antigravity', status: 'error', label: 'Refresh failed', buckets: [] };
}

/** No `reports` is not an error: OMP is simply not signed in to anything with quota. */
export async function probeOmp(execFn, homeDir) {
  try {
    const res = await runCommand(execFn, homeDir, 'omp', ['usage', '--json'], 60000);
    if (res && res.code === 0 && res.stdout) {
      return parseOmpUsage(res.stdout) ?? [];
    }
  } catch {
    // OMP missing or wedged: the bar shows no OMP providers rather than a fake one.
  }
  return [];
}

export async function probeAllProviders(deps) {
  const execFn = deps?.exec ?? (async () => ({ code: 1, stdout: '' }));
  const homeDir = deps?.home ?? null;

  const [antigravity, omp] = await Promise.all([
    probeAntigravity(execFn, homeDir),
    probeOmp(execFn, homeDir)
  ]);
  return { providers: [antigravity, ...omp] };
}
