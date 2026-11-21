// Generated from shared/review-store.js by scripts/sync-shared.mjs. Edit that file, not this copy.
// Review Store: cached PR review store for workspace cards and changes panel.
// Port of Orca's hosted review branch cache (`hosted-review-branch-cache.ts:50-100`)
// and refresh pacing (`hosted-review-refresh-pacing.ts:4-28`).

import { shared, setShared } from "herdr";

// Orca `hosted-review-branch-cache.ts:59` FOUND_REVIEW_TTL_MS (1 min)
export const FOUND_REVIEW_TTL_MS = 60_000;

// Orca `hosted-review-refresh-pacing.ts:4` NO_REVIEW_REFRESH_INTERVAL_MS (15 min)
export const NO_REVIEW_REFRESH_INTERVAL_MS = 15 * 60_000;

// Orca `hosted-review-refresh-pacing.ts:28` MAX_UNSETTLED_LOOKUPS_PER_KEY (max 2 concurrent)
export const MAX_INFLIGHT_PR_LOOKUPS = 2;

// Orca `pr-branch-lookup.ts:28` BRANCH_PR_LOOKUP_PAGE_SIZE (10)
export const BRANCH_PR_LOOKUP_PAGE_SIZE = 10;

// Cap the on-disk review cache so it cannot grow without bound across repos/branches.
const MAX_REVIEW_CACHE_ENTRIES = 200;

/**
 * Key format `<common-dir>::<branch>`
 * Matches Orca's scope-prefixed branch cache key (`hosted-review-branch-cache.ts:66-79`).
 */
export function reviewKey(repo, branch) {
  return `${repo}::${branch}`;
}

/**
 * Determines whether a cached review entry is fresh.
 * Port of Orca's `isFresh` (`hosted-review-branch-cache.ts:93-100`).
 * An entry with found review data is fresh for 1 min (FOUND_REVIEW_TTL_MS).
 * A negative cache entry ({ data: null }) is fresh for 15 min (NO_REVIEW_REFRESH_INTERVAL_MS).
 */
export function isReviewFresh(entry, now = Date.now()) {
  if (!entry || typeof entry.at !== "number") return false;
  if (entry.data && entry.data.title === undefined) return false;
  const ttl = entry.data ? FOUND_REVIEW_TTL_MS : NO_REVIEW_REFRESH_INTERVAL_MS;
  return (now - entry.at) < ttl;
}

/**
 * Loads the review cache, checking shared("pr.cache.v2") first, then localStorage.
 */
export function loadReviewCache() {
  const sh = shared("pr.cache.v2");
  if (sh && typeof sh === "object" && !Array.isArray(sh)) return { ...sh };
  try {
    const v = localStorage.getItem("pr.cache.v2");
    return v ? JSON.parse(v) : {};
  } catch {
    return {};
  }
}

/**
 * Saves review cache to localStorage and broadcasts via setShared.
 */
export function saveReviewCache(cache) {
  // Evict the least recently refreshed entries; `at` also controls freshness.
  const keys = Object.keys(cache);
  if (keys.length > MAX_REVIEW_CACHE_ENTRIES) {
    const active = shared("pr.active.v1");
    const protectedKeys = new Set(Array.isArray(active) ? active : []);
    const now = Date.now();
    // shortcut: active or fresh branches can exceed the cap, preserve refresh pacing.
    keys
      .filter((k) => !protectedKeys.has(k) && !isReviewFresh(cache[k], now))
      .map((k) => ({ k, at: (cache[k] && typeof cache[k].at === "number") ? cache[k].at : 0 }))
      .sort((a, b) => a.at - b.at)
      .slice(0, keys.length - MAX_REVIEW_CACHE_ENTRIES)
      .forEach(({ k }) => { delete cache[k]; });
  }
  try {
    localStorage.setItem("pr.cache.v2", JSON.stringify(cache));
  } catch {}
  setShared("pr.cache.v2", cache);
}

/**
 * Records a review entry immediately and notifies subscribers.
 * Port of Orca's `storeEntry` (`hosted-review-branch-cache.ts:102-112`).
 */
export function recordReview(repo, branch, data) {
  const key = reviewKey(repo, branch);
  const cache = loadReviewCache();
  cache[key] = { data, at: Date.now() };
  saveReviewCache(cache);
  return cache;
}

/**
 * Invalidates review cache entries for a repository or specific branch.
 * Port of Orca's `invalidateHostedReviewBranchCache` (`hosted-review-branch-cache.ts:115-129`).
 */
export function invalidateReview(repo, branch) {
  const cache = loadReviewCache();
  if (branch) {
    delete cache[reviewKey(repo, branch)];
  } else {
    const prefix = `${repo}::`;
    for (const k of Object.keys(cache)) {
      if (k.startsWith(prefix)) delete cache[k];
    }
  }
  saveReviewCache(cache);
  return cache;
}
