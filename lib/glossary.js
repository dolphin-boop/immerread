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
export function missingFixedTerms(glossary, segments, items) {
  const byId = new Map((items || []).map((item) => [String(item.id), item]));
  return (segments || []).flatMap((segment) => {
    const translated = String(byId.get(String(segment.id))?.translation || "").replace(/<[^>]*>/g, "");
    return matchingGlossaryEntries(glossary, segment.text)
      .filter((entry) => !translated.includes(entry.target))
      .map((entry) => ({ id: String(segment.id), source: entry.source, target: entry.target }));
  });
}

function replaceSourceWithToken(value, source, token) {
  const escaped = source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`, "gi");
  return String(value || "").replace(pattern, (_match, before) => before + token);
}

export function prepareFixedTermRetry(glossary, segments) {
  const replacements = new Map();
  const prepared = (segments || []).map((segment, segmentIndex) => {
    let text = segment.text;
    let markup = segment.markup || segment.text;
    const entries = matchingGlossaryEntries(glossary, segment.text);
    const terms = [];
    entries.forEach((entry, entryIndex) => {
      const token = `__YIDU_TERM_${segmentIndex}_${entryIndex}__`;
      const nextText = replaceSourceWithToken(text, entry.source, token);
      if (nextText === text) return;
      const nextMarkup = replaceSourceWithToken(markup, entry.source, token);
      if (!nextMarkup.includes(token)) throw new Error(`固定译法无法对应原文格式：${entry.source}`);
      text = nextText;
      markup = nextMarkup;
      terms.push({ token, source: entry.source, target: entry.target });
    });
    replacements.set(String(segment.id), terms);
    return { ...segment, text, markup };
  });
  return { segments: prepared, replacements };
}

export function restoreFixedTermRetry(items, replacements) {
  return (items || []).map((item) => {
    let translation = item.translation;
    for (const term of replacements.get(String(item.id)) || []) {
      if (!translation.includes(term.token)) throw new Error(`模型未保留固定译法：${term.source}`);
      const safeTarget = term.target.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      translation = translation.split(term.token).join(safeTarget);
    }
    return { ...item, translation };
  });
}
