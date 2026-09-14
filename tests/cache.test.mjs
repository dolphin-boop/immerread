import assert from "node:assert/strict";
import test from "node:test";
import {
  CACHE_TTL_MS,
  MAX_CACHED_ARTICLES,
  makeArticleKey,
  mergeCachedItems,
  normalizeArticleUrl,
  pruneCache,
  readCachedItems
} from "../lib/cache.js";

const segments = [{ id: "1", kind: "body", text: "An agent evaluates a model." }];
const items = [{ id: "1", translation: "智能体评估模型。", terms: [{ source: "agent", target: "智能体" }] }];

test("stores and restores paragraph translations by URL and content", () => {
  const cache = mergeCachedItems({}, { url: "https://example.com/a#section", segments, items, model: "deepseek-chat" }, 1000);
  const restored = readCachedItems(cache, { url: "https://example.com/a", segments, model: "deepseek-chat" }, 1001);
  assert.deepEqual(restored.items, items);
  assert.equal(normalizeArticleUrl("https://example.com/a#section"), "https://example.com/a");
});

test("invalidates cache when paragraph content or model changes", () => {
  const cache = mergeCachedItems({}, { url: "https://example.com/a", segments, items, model: "deepseek-chat" }, 1000);
  assert.equal(readCachedItems(cache, {
    url: "https://example.com/a",
    segments: [{ ...segments[0], text: "Changed article text." }],
    model: "deepseek-chat"
  }, 1001).items.length, 0);
  assert.equal(readCachedItems(cache, { url: "https://example.com/a", segments, model: "another-model" }, 1001).items.length, 0);
});

test("expires old entries and keeps only the most recent articles", () => {
  const articles = {};
  for (let index = 0; index < MAX_CACHED_ARTICLES + 4; index += 1) {
    articles[makeArticleKey(`https://example.com/${index}`)] = { updatedAt: 1000 + index, entries: {} };
  }
  articles.expired = { updatedAt: 999 - CACHE_TTL_MS, entries: {} };
  const clean = pruneCache({ articles }, 1000);
  assert.equal(Object.keys(clean.articles).length, MAX_CACHED_ARTICLES);
  assert.equal(clean.articles.expired, undefined);
});
