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

export function removeGlossaryEntry(glossary, source) {
  const key = String(source || "").trim().toLocaleLowerCase();
  const entries = { ...(glossary?.entries || {}) };
  const removed = entries[key] || null;
  delete entries[key];
  return { glossary: { version: 1, entries }, removed };
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

function escapeFixedTarget(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function replaceWithFixedTarget(translation, learnedTarget, fixedTarget) {
  const rawTarget = String(fixedTarget);
  return String(translation).replaceAll(learnedTarget, (match, offset, whole) => {
    let replacement = escapeFixedTarget(rawTarget);
    const before = whole[offset - 1] || "";
    const after = whole[offset + match.length] || "";
    if (/^[A-Za-z0-9]/.test(rawTarget) && /[\u3400-\u9fff]/.test(before)) replacement = " " + replacement;
    if (/[A-Za-z0-9]$/.test(rawTarget) && /[\u3400-\u9fff]/.test(after)) replacement += " ";
    return replacement;
  });
}

function learnedTargetForFixedSource(entry, source, translation) {
  const entrySource = String(entry?.source || "");
  const entryTarget = String(entry?.target || "");
  if (!entrySource || !entryTarget) return "";
  let candidate = entryTarget;
  if (entrySource.toLocaleLowerCase() !== source.toLocaleLowerCase()) {
    if (!containsTerm(entrySource, source)) return "";
    const index = entrySource.toLocaleLowerCase().indexOf(source.toLocaleLowerCase());
    const prefix = entrySource.slice(0, index).trim();
    const suffix = entrySource.slice(index + source.length).trim();
    if (prefix && candidate.toLocaleLowerCase().startsWith(prefix.toLocaleLowerCase())) {
      candidate = candidate.slice(prefix.length).trim();
    }
    if (suffix && candidate.toLocaleLowerCase().endsWith(suffix.toLocaleLowerCase())) {
      candidate = candidate.slice(0, -suffix.length).trim();
    }
  }
  return candidate && translation.includes(candidate) ? candidate : "";
}

export function restoreFixedTermRetry(items, replacements, fallbackItems = new Map()) {
  return (items || []).map((item) => {
    let translation = item.translation;
    const fixedTerms = replacements.get(String(item.id)) || [];
    const fallback = fallbackItems.get(String(item.id));
    if (fallback && fixedTerms.some((term) => !translation.includes(term.token))) {
      translation = fallback.translation;
      const terms = (fallback.terms || []).map((entry) => ({ ...entry }));
      const unresolved = [];
      for (const term of fixedTerms) {
        if (translation.includes(term.target)) continue;
        const learned = terms.map((entry) => ({
          entry,
          target: learnedTargetForFixedSource(entry, term.source, translation)
        })).find((candidate) => candidate.target);
        if (!learned) {
          unresolved.push(term.source);
          continue;
        }
        translation = replaceWithFixedTarget(translation, learned.target, term.target);
        learned.entry.target = term.target;
      }
      return {
        ...fallback,
        translation,
        terms,
        ...(unresolved.length ? { fixedTermWarning: unresolved.join(", ") } : {})
      };
    }
    for (const term of fixedTerms) {
      translation = replaceWithFixedTarget(translation, term.token, term.target);
    }
    return { ...item, translation };
  });
}
