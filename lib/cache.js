import { segmentGlossarySignature } from "./glossary.js";

export const CACHE_STORAGE_KEY = "yiduTranslationCacheV1";
export const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const MAX_CACHED_ARTICLES = 20;
export const PROMPT_VERSION = "rich-text-v4";

export function stableHash(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function normalizeArticleUrl(value) {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.href;
  } catch {
    return String(value || "").split("#")[0];
  }
}

export function makeArticleKey(url) {
  return stableHash(normalizeArticleUrl(url));
}

export function makeSegmentKey(segment, model, glossary) {
  const base = [PROMPT_VERSION, model, segment.kind || "paragraph", segment.text, segment.markup || ""].join("\u0000");
  const signature = segmentGlossarySignature(glossary, segment);
  return stableHash(signature ? base + "\u0000" + signature : base);
}

export function pruneCache(cache, now = Date.now()) {
  const articles = Object.fromEntries(
    Object.entries(cache?.articles || {})
      .filter(([, article]) => now - Number(article?.updatedAt || 0) <= CACHE_TTL_MS)
      .sort(([, left], [, right]) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0))
      .slice(0, MAX_CACHED_ARTICLES)
  );
  return { version: 1, articles };
}

export function readCachedItems(cache, { url, segments, model, glossary }, now = Date.now()) {
  const clean = pruneCache(cache, now);
  const article = clean.articles[makeArticleKey(url)];
  if (!article) return { cache: clean, items: [] };
  const items = segments.flatMap((segment) => {
    const entry = article.entries?.[makeSegmentKey(segment, model, glossary)];
    return entry ? [{ id: String(segment.id), translation: entry.translation, terms: entry.terms || [] }] : [];
  });
  return { cache: clean, items };
}

export function mergeCachedItems(cache, { url, segments, items, model, glossary }, now = Date.now()) {
  const clean = pruneCache(cache, now);
  const articleKey = makeArticleKey(url);
  const previous = clean.articles[articleKey] || { url: normalizeArticleUrl(url), entries: {} };
  const entries = { ...previous.entries };
  const segmentsById = new Map(segments.map((segment) => [String(segment.id), segment]));
  for (const item of items) {
    const segment = segmentsById.get(String(item.id));
    if (!segment || typeof item.translation !== "string") continue;
    entries[makeSegmentKey(segment, model, glossary)] = {
      translation: item.translation,
      terms: Array.isArray(item.terms) ? item.terms : []
    };
  }
  clean.articles[articleKey] = { url: normalizeArticleUrl(url), updatedAt: now, entries };
  return pruneCache(clean, now);
}
