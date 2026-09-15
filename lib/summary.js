import { stableHash, normalizeArticleUrl } from "./cache.js";

export const SUMMARY_STORAGE_KEY = "yiduSummaryCacheV1";
const MAX_MODULE_CHARS = 8000;
const SUMMARY_TTL_MS = 30 * 24 * 60 * 60 * 1000;

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

export function buildSummaryMessages({ articleTitle, module, glossary = {} }) {
  const fixedTerms = Object.entries(glossary).map(([source, target]) => source + " => " + target).join("\n");
  return [
    {
      role: "system",
      content: [
        "你是英文技术文章总结助手。按当前大模块总结，不要概括未提供的章节。",
        "用简洁自然的中文说明这一模块的主旨和关键论点；保留事实、限制和重要数字，不编造。",
        "产品、模型和 API 名称保持原文；不要加入原文没有的判断。",
        fixedTerms ? "沿用用户固定译法：\n" + fixedTerms : "",
        '只返回 JSON：{"summary":"一到两句话的模块概述","points":["关键点一","关键点二"]}。',
        "points 根据内容写 2 到 4 条；如果信息很少，可只写 1 条。不要 Markdown。"
      ].filter(Boolean).join("\n")
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

export function parseSummaryResponse(raw) {
  if (typeof raw !== "string" || !raw.trim()) throw new Error("总结服务没有返回内容");
  const parsed = JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
  const summary = typeof parsed.summary === "string" ? parsed.summary.trim() : "";
  const points = Array.isArray(parsed.points) ? parsed.points.map((point) => String(point || "").trim()).filter(Boolean) : [];
  if (!summary || !points.length || points.length > 5) throw new Error("总结结果格式不正确");
  return { summary, points };
}

export function makeSummaryKey(url, module, model, glossary = {}) {
  return stableHash([normalizeArticleUrl(url), model, module.title,
    module.segments.map((segment) => segment.kind + ":" + segment.text).join("\n"),
    JSON.stringify(glossary)].join("\u0000"));
}

export function readCachedSummary(cache, key, now = Date.now()) {
  const entry = cache?.entries?.[key];
  return entry && now - Number(entry.updatedAt || 0) <= SUMMARY_TTL_MS ? entry.result : null;
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

