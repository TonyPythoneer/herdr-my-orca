import { describe, it } from "vite-plus/test";
import assert from "node:assert/strict";
import {
  BRANCH_PR_LOOKUP_PAGE_SIZE,
  FOUND_REVIEW_TTL_MS,
  MAX_INFLIGHT_PR_LOOKUPS,
  NO_REVIEW_REFRESH_INTERVAL_MS,
  invalidateReview,
  isReviewFresh,
  loadReviewCache,
  recordReview,
  reviewKey,
  saveReviewCache,
  type ReviewCache,
  type ReviewEntry,
} from "../../src/shared/review-store";

type StorageLike = Pick<Storage, "getItem" | "setItem">;
type TestGlobal = {
  __herdrShared?: (key: string) => unknown;
  __herdrSetShared?: (key: string, value: unknown) => void;
  localStorage?: StorageLike;
};

const host: TestGlobal = globalThis;

function setup(sharedState: Map<string, unknown>, storage: StorageLike) {
  host.__herdrShared = (key) => sharedState.get(key);
  host.__herdrSetShared = (key, value) => sharedState.set(key, value);
  host.localStorage = storage;
}

function cleanup() {
  delete host.__herdrShared;
  delete host.__herdrSetShared;
  delete host.localStorage;
}

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

describe("review cache source behavior", () => {
  it("keeps the shared lookup limits stable", () => {
    assert.equal(FOUND_REVIEW_TTL_MS, 60_000);
    assert.equal(NO_REVIEW_REFRESH_INTERVAL_MS, 15 * 60_000);
    assert.equal(MAX_INFLIGHT_PR_LOOKUPS, 2);
    assert.equal(BRANCH_PR_LOOKUP_PAGE_SIZE, 10);
  });

  it("uses repo and branch as an unambiguous cache key", () => {
    assert.equal(reviewKey("/work/tree", "feature/a"), "/work/tree::feature/a");
  });

  it("expires found and missing reviews at their distinct TTL boundaries", () => {
    assert.equal(
      isReviewFresh({ at: 100, data: { title: "PR" } }, 100 + FOUND_REVIEW_TTL_MS - 1),
      true,
    );
    assert.equal(
      isReviewFresh({ at: 100, data: { title: "PR" } }, 100 + FOUND_REVIEW_TTL_MS),
      false,
    );
    assert.equal(
      isReviewFresh({ at: 100, data: null }, 100 + NO_REVIEW_REFRESH_INTERVAL_MS - 1),
      true,
    );
    assert.equal(
      isReviewFresh({ at: 100, data: null }, 100 + NO_REVIEW_REFRESH_INTERVAL_MS),
      false,
    );
    assert.equal(isReviewFresh({ at: 100, data: {} }, 101), false);
    const stringTimestamp: ReviewEntry = Object.fromEntries([["at", "100"]]);
    assert.equal(isReviewFresh(stringTimestamp, 101), false);
    assert.equal(isReviewFresh(undefined, 101), false);
  });

  it("prefers shared cache state and falls back to valid local storage data", () => {
    const storage = memoryStorage();
    const sharedState = new Map<string, unknown>();
    setup(sharedState, storage);
    try {
      sharedState.set("pr.cache.v2", { shared: { at: 1, data: null } });
      const sharedCache = loadReviewCache();
      assert.deepEqual(sharedCache, { shared: { at: 1, data: null } });
      assert.notEqual(sharedCache, sharedState.get("pr.cache.v2"));

      sharedState.set("pr.cache.v2", null);
      storage.setItem("pr.cache.v2", JSON.stringify({ local: { at: 2, data: null } }));
      assert.deepEqual(loadReviewCache(), { local: { at: 2, data: null } });
      storage.setItem("pr.cache.v2", "[");
      assert.deepEqual(loadReviewCache(), {});
      storage.setItem("pr.cache.v2", "[]");
      assert.deepEqual(loadReviewCache(), []);
    } finally {
      cleanup();
    }
  });

  it("falls back to browser storage when the shared cache is not an object", () => {
    const storage = memoryStorage();
    const sharedState = new Map<string, unknown>();
    setup(sharedState, storage);
    try {
      sharedState.set("pr.cache.v2", "stale");
      storage.setItem("pr.cache.v2", JSON.stringify({ local: { at: 3, data: null } }));
      assert.deepEqual(loadReviewCache(), { local: { at: 3, data: null } });
      storage.setItem("pr.cache.v2", "null");
      assert.equal(loadReviewCache(), null);
    } finally {
      cleanup();
    }
  });

  it("evicts the oldest stale entries while retaining the newest cache window", () => {
    const storage = memoryStorage();
    const sharedState = new Map<string, unknown>();
    setup(sharedState, storage);
    const cache: ReviewCache = Object.fromEntries(
      Array.from({ length: 205 }, (_, index) => [String(index), { at: index, data: null }]),
    );
    try {
      saveReviewCache(cache);
      assert.equal(Object.keys(cache).length, 200);
      assert.equal(cache["4"], undefined);
      assert.equal(cache["5"]?.at, 5);
      assert.deepEqual(JSON.parse(storage.values.get("pr.cache.v2") ?? "null"), cache);
      assert.equal(sharedState.get("pr.cache.v2"), cache);
    } finally {
      cleanup();
    }
  });

  it("protects active stale entries and does not evict fresh entries to meet the cap", () => {
    const storage = memoryStorage();
    const sharedState = new Map<string, unknown>();
    setup(sharedState, storage);
    const cache: ReviewCache = Object.fromEntries(
      Array.from({ length: 205 }, (_, index) => [`active-${index}`, { at: index, data: null }]),
    );
    cache.stale = { at: -1, data: null };
    sharedState.set(
      "pr.active.v1",
      Object.keys(cache).filter((key) => key !== "stale"),
    );
    try {
      saveReviewCache(cache);
      assert.equal(Object.keys(cache).length, 205);
      assert.ok(Object.keys(cache).every((key) => key !== "stale"));

      sharedState.set("pr.active.v1", []);
      const fresh = Object.fromEntries(
        Array.from({ length: 205 }, (_, index) => [
          `fresh-${index}`,
          { at: Date.now(), data: null },
        ]),
      );
      saveReviewCache(fresh);
      assert.equal(Object.keys(fresh).length, 205);
    } finally {
      cleanup();
    }
  });

  it("evicts entries without a timestamp before timestamped entries", () => {
    const storage = memoryStorage();
    const sharedState = new Map<string, unknown>();
    setup(sharedState, storage);
    const cache: ReviewCache = Object.fromEntries(
      Array.from({ length: 200 }, (_, index) => [String(index + 1), { at: index + 1, data: null }]),
    );
    cache.untimed = { data: null };
    try {
      saveReviewCache(cache);
      assert.equal(Object.keys(cache).length, 200);
      assert.equal(cache.untimed, undefined);
      assert.equal(cache["1"]?.at, 1);
    } finally {
      cleanup();
    }
  });

  it("updates shared state even when browser storage rejects writes", () => {
    const sharedState = new Map<string, unknown>();
    setup(sharedState, {
      getItem: () => null,
      setItem: () => {
        throw new Error("storage quota exceeded");
      },
    });
    const cache: ReviewCache = { current: { at: 1, data: null } };
    try {
      saveReviewCache(cache);
      assert.equal(sharedState.get("pr.cache.v2"), cache);
    } finally {
      cleanup();
    }
  });

  it("records one branch and invalidates exactly that branch or its repository", () => {
    const storage = memoryStorage();
    const sharedState = new Map<string, unknown>();
    setup(sharedState, storage);
    try {
      recordReview("/repo", "feature/a", { title: "A" });
      recordReview("/repo", "feature/b", null);
      recordReview("/repo-other", "feature/a", null);
      const oneBranch = invalidateReview("/repo", "feature/a");
      assert.equal(oneBranch[reviewKey("/repo", "feature/a")], undefined);
      assert.ok(oneBranch[reviewKey("/repo", "feature/b")]);
      assert.ok(oneBranch[reviewKey("/repo-other", "feature/a")]);

      const repository = invalidateReview("/repo");
      assert.equal(repository[reviewKey("/repo", "feature/b")], undefined);
      assert.ok(repository[reviewKey("/repo-other", "feature/a")]);
    } finally {
      cleanup();
    }
  });
});
