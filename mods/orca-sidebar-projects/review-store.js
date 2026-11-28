import { setShared, shared } from "herdr";

                             
const FOUND_REVIEW_TTL_MS = 6e4;
const NO_REVIEW_REFRESH_INTERVAL_MS = 9e5;
const MAX_INFLIGHT_PR_LOOKUPS = 2;
const BRANCH_PR_LOOKUP_PAGE_SIZE = 10;
const MAX_REVIEW_CACHE_ENTRIES = 200;
const CACHE_KEY = "pr.cache.v2";
const ACTIVE_KEY = "pr.active.v1";
const KEY_SEPARATOR = "::";
function isReviewCacheRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function reviewKey(repo, branch) {
	return `${repo}${KEY_SEPARATOR}${branch}`;
}
function isReviewFresh(entry, now = Date.now()) {
	if (!entry || typeof entry.at !== "number") return false;
	if (entry.data && entry.data.title === void 0) return false;
	const ttl = entry.data ? FOUND_REVIEW_TTL_MS : NO_REVIEW_REFRESH_INTERVAL_MS;
	return now - entry.at < ttl;
}
function loadReviewCache() {
	const sh = shared(CACHE_KEY);
	if (isReviewCacheRecord(sh)) return { ...sh };
	try {
		const v = localStorage.getItem(CACHE_KEY);
		return v ? JSON.parse(v) : {};
	} catch {
		return {};
	}
}
function saveReviewCache(cache) {
	const keys = Object.keys(cache);
	if (keys.length > MAX_REVIEW_CACHE_ENTRIES) {
		const active = shared(ACTIVE_KEY);
		const protectedKeys = new Set(Array.isArray(active) ? active : []);
		const now = Date.now();
		keys.filter((k) => !protectedKeys.has(k) && !isReviewFresh(cache[k], now)).map((k) => ({
			k,
			at: cache[k] && typeof cache[k].at === "number" ? cache[k].at : 0
		})).sort((a, b) => a.at - b.at).slice(0, keys.length - MAX_REVIEW_CACHE_ENTRIES).forEach(({ k }) => {
			delete cache[k];
		});
	}
	try {
		localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
	} catch {}
	setShared(CACHE_KEY, cache);
}
function recordReview(repo, branch, data) {
	const key = reviewKey(repo, branch);
	const cache = loadReviewCache();
	cache[key] = {
		data,
		at: Date.now()
	};
	saveReviewCache(cache);
	return cache;
}
function invalidateReview(repo, branch) {
	const cache = loadReviewCache();
	if (branch) delete cache[reviewKey(repo, branch)];
	else {
		const prefix = `${repo}${KEY_SEPARATOR}`;
		for (const k of Object.keys(cache)) if (k.startsWith(prefix)) delete cache[k];
	}
	saveReviewCache(cache);
	return cache;
}

export { BRANCH_PR_LOOKUP_PAGE_SIZE, FOUND_REVIEW_TTL_MS, MAX_INFLIGHT_PR_LOOKUPS, NO_REVIEW_REFRESH_INTERVAL_MS, invalidateReview, isReviewFresh, loadReviewCache, recordReview, reviewKey, saveReviewCache };
