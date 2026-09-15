export const GLOSSARY_STORAGE_KEY = "yiduGlossaryV1";

export function normalizeGlossaryEntry(source, target) {
  const english = String(source || "").replace(/\s+/g, " ").trim();
  const chinese = String(target || "").replace(/\s+/g, " ").trim();
  if (!english || !/[A-Za-z]/.test(english) || english.length > 80 || english.split(" ").length > 8) {
    throw new Error("请选择不超过 8 个英文单词的术语。");
  }
  if (!chinese || chinese.length > 80) throw new Error("请输入不超过 80 字的指定译法。");
  return { source: english, target: chinese };
}

export function upsertGlossary(glossary, source, target, now = Date.now()) {
  const entry = normalizeGlossaryEntry(source, target);
  const key = entry.source.toLocaleLowerCase();
  return { version: 1, entries: { ...(glossary?.entries || {}), [key]: { ...entry, updatedAt: now } } };
}

export function containsTerm(text, source) {
  const haystack = String(text || "").toLocaleLowerCase();
  const needle = String(source || "").toLocaleLowerCase();
  if (!needle) return false;
  let index = haystack.indexOf(needle);
  while (index >= 0) {
    const before = haystack[index - 1] || "";
    const after = haystack[index + needle.length] || "";
    if (!/[a-z0-9]/i.test(before) && !/[a-z0-9]/i.test(after)) return true;
    index = haystack.indexOf(needle, index + 1);
  }
  return false;
}

export function matchingGlossaryEntries(glossary, text) {
  return Object.values(glossary?.entries || {})
    .filter((entry) => entry?.source && entry?.target && containsTerm(text, entry.source))
    .sort((left, right) => right.source.length - left.source.length || left.source.localeCompare(right.source));
}

export function glossaryForSegments(glossary, segments) {
  const relevant = Object.values(glossary?.entries || {})
    .filter((entry) => entry?.source && entry?.target && (segments || []).some((segment) => containsTerm(segment.text, entry.source)))
    .sort((left, right) => right.source.length - left.source.length || left.source.localeCompare(right.source));
  return Object.fromEntries(relevant.map((entry) => [entry.source, entry.target]));
}

export function segmentGlossarySignature(glossary, segment) {
  return matchingGlossaryEntries(glossary, segment?.text)
    .map((entry) => entry.source.toLocaleLowerCase() + "=" + entry.target)
    .sort()
    .join("\u0000");
}