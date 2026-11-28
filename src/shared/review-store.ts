import { shared, setShared } from "herdr";

export type ReviewData = Record<string, unknown> | null;
export type ReviewEntry = { data?: ReviewData; at?: number };
export type ReviewCache = Record<string, ReviewEntry>;

export const FOUND_REVIEW_TTL_MS = 60_000;

export const NO_REVIEW_REFRESH_INTERVAL_MS = 15 * 60_000;

export const MAX_INFLIGHT_PR_LOOKUPS = 2;

export const BRANCH_PR_LOOKUP_PAGE_SIZE = 10;

const MAX_REVIEW_CACHE_ENTRIES = 200;
const CACHE_KEY = "pr.cache.v2";
const ACTIVE_KEY = "pr.active.v1";
const KEY_SEPARATOR = "::";

function isReviewCacheRecord(value: unknown): value is ReviewCache {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function reviewKey(repo: string, branch: string): string {
  return `${repo}${KEY_SEPARATOR}${branch}`;
}

export function isReviewFresh(entry: ReviewEntry | null | undefined, now = Date.now()): boolean {
  if (!entry || typeof entry.at !== "number") return false;
  if (entry.data && entry.data.title === undefined) return false;
  const ttl = entry.data ? FOUND_REVIEW_TTL_MS : NO_REVIEW_REFRESH_INTERVAL_MS;
  return now - entry.at < ttl;
}

export function loadReviewCache(): ReviewCache {
  const sh = shared(CACHE_KEY);
  if (isReviewCacheRecord(sh)) return { ...sh };
  try {
    const v = localStorage.getItem(CACHE_KEY);
    return v ? (JSON.parse(v) as ReviewCache) : {};
  } catch {
    return {};
  }
}

export function saveReviewCache(cache: ReviewCache): void {
  const keys = Object.keys(cache);
  if (keys.length > MAX_REVIEW_CACHE_ENTRIES) {
    const active = shared(ACTIVE_KEY);
    const protectedKeys = new Set<unknown>(Array.isArray(active) ? active : []);
    const now = Date.now();
    keys
      .filter((k) => !protectedKeys.has(k) && !isReviewFresh(cache[k], now))
      .map((k) => ({
        k,
        at: cache[k] && typeof cache[k].at === "number" ? cache[k].at : 0,
      }))
      .sort((a, b) => a.at - b.at)
      .slice(0, keys.length - MAX_REVIEW_CACHE_ENTRIES)
      .forEach(({ k }) => {
        delete cache[k];
      });
  }
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {}
  setShared(CACHE_KEY, cache);
}

export function recordReview(repo: string, branch: string, data: ReviewData): ReviewCache {
  const key = reviewKey(repo, branch);
  const cache = loadReviewCache();
  cache[key] = { data, at: Date.now() };
  saveReviewCache(cache);
  return cache;
}

export function invalidateReview(repo: string, branch?: string | null): ReviewCache {
  const cache = loadReviewCache();
  if (branch) {
    delete cache[reviewKey(repo, branch)];
  } else {
    const prefix = `${repo}${KEY_SEPARATOR}`;
    for (const k of Object.keys(cache)) {
      if (k.startsWith(prefix)) delete cache[k];
    }
  }
  saveReviewCache(cache);
  return cache;
}
