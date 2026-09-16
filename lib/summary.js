import { stableHash, normalizeArticleUrl } from "./cache.js";

export const SUMMARY_STORAGE_KEY = "yiduSummaryCacheV1";
const SUMMARY_PROMPT_VERSION = "module-v3";
const MAX_MODULE_CHARS = 8000;
const SUMMARY_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_SUMMARY_CHARS = 60;

export function groupArticleModules(article) {
  const segments = (article?.segments || []).filter((segment) => segment.kind !== "skipped" && segment.kind !== "h1");
  const headingKind = segments.some((segment) => segment.kind === "h2") ? "h2"
    : segments.some((segment) => segment.kind === "h3") ? "h3" : "";
  const modules = [];
  let current = null;
  let sectionTitle = headingKind ? "导读" : "文章内容";
  let sectionPart = 1;
  let chars = 0;
  function finish() {
    if (current?.segments.length) modules.push(current);
    current = null;
    chars = 0;
  }
  function open(segment) {
    current = {
      id: String(segment.id),
      startId: String(segment.id),
      title: sectionPart > 1 ? sectionTitle + "（第 " + sectionPart + " 部分）" : sectionTitle,
      segments: []
    };
  }
  for (const segment of segments) {
    if (headingKind && segment.kind === headingKind) {
      finish();
      sectionTitle = segment.text;
      sectionPart = 1;
    }
    if (current && chars + segment.text.length > MAX_MODULE_CHARS) {
      finish();
      sectionPart += 1;
    }
    if (!current) open(segment);
    current.segments.push({ id: String(segment.id), kind: segment.kind, text: segment.text });
    chars += segment.text.length;
  }
  finish();
  if (!headingKind) modules.forEach((module, index) => {
    module.title = "第 " + (index + 1) + " 部分";
  });
  return modules;
}

export function buildSummaryMessages({ articleTitle, module }) {
  return [
    {
      role: "system",
      content: [
        "你是英文技术文章的结构化导读助手。输出像目录摘要，不要像翻译或逐段复述。",
        "只概括当前大模块，不要概括未提供的章节。",
        "title 是简短中文章节标题；原文已有明确标题时忠实翻译。",
        "summary 只写一句中文，最多 60 个汉字，概括本模块的核心作用或结论。",
        "删除例子、过程细节、并列论据和背景铺陈；除非数字本身就是核心结论，否则不要列数字。",
        "产品、模型和 API 名称保持原文，不新增判断。",
        '{"title":"中文章节标题","summary":"一句短概述"}。只返回这个 JSON，不要 Markdown，不要 points 或列表。'
      ].join("\n")
    },
    {
      role: "user",
      content: JSON.stringify({
        articleTitle,
        moduleTitle: module.title,
        segments: module.segments.map(({ id, kind, text }) => ({ id, kind, text }))
      })
    }
  ];
}

function compactSummary(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  const firstSentence = text.match(/^.*?[。！？!?]/u)?.[0] || text;
  return firstSentence.length <= MAX_SUMMARY_CHARS
    ? firstSentence
    : firstSentence.slice(0, MAX_SUMMARY_CHARS - 1).trimEnd() + "…";
}

export function parseSummaryResponse(raw, fallbackTitle = "") {
  if (typeof raw !== "string" || !raw.trim()) throw new Error("总结服务没有返回内容");
  const cleaned = raw.trim()
    .replace(new RegExp("^\\x60{3}(?:json)?\\s*", "i"), "")
    .replace(new RegExp("\\s*\\x60{3}$"), "");
  const parsed = JSON.parse(cleaned);
  const source = parsed?.result && typeof parsed.result === "object" ? parsed.result : parsed;
  const title = String(source?.title || source?.heading || source?.chapterTitle || fallbackTitle || "").trim();
  const summary = compactSummary(source?.summary || source?.overview || source?.description || source?.content);
  if (!title || !summary) throw new Error("总结结果格式不正确");
  return { title, summary };
}

export function makeSummaryKey(url, module, model, articleTitle = "") {
  return stableHash([SUMMARY_PROMPT_VERSION, normalizeArticleUrl(url), model, articleTitle, module.title,
    module.segments.map((segment) => segment.kind + ":" + segment.text).join("\n")].join("\u0000"));
}

export function readCachedSummary(cache, key, now = Date.now()) {
  const entry = cache?.entries?.[key];
  const result = entry?.result;
  return entry && now - Number(entry.updatedAt || 0) <= SUMMARY_TTL_MS &&
    typeof result?.title === "string" && result.title.trim() &&
    typeof result.summary === "string" && result.summary.trim()
    ? { title: result.title.trim(), summary: compactSummary(result.summary) } : null;
}

export function saveCachedSummary(cache, key, result, now = Date.now()) {
  const entries = Object.fromEntries(Object.entries({
    ...(cache?.entries || {}),
    [key]: { updatedAt: now, result }
  })
    .filter(([, entry]) => now - Number(entry.updatedAt || 0) <= SUMMARY_TTL_MS)
    .sort(([, left], [, right]) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0))
    .slice(0, 120));
  return { version: 1, entries };
}

