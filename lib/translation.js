const DEFAULT_MODEL = "deepseek-chat";

const NON_AI_TERMS = new Set([
  "api", "sdk", "framework", "database", "browser", "server", "client",
  "frontend", "backend", "full stack", "javascript", "typescript", "python",
  "java", "html", "css", "http", "https", "tcp", "ip", "url", "website",
  "web page", "function", "class", "variable", "object", "array", "git",
  "github", "docker", "kubernetes"
]);

export function buildTranslationMessages({ title, segments, glossary = {} }) {
  const lockedTerms = Object.entries(glossary)
    .map(([source, target]) => `${source} => ${target}`)
    .join("\n");

  return [
    {
      role: "system",
      content: [
        "你是专业的英中技术文章翻译器。",
        "忠实翻译，不增删信息；产品名、模型名、API 名称保持原文。",
        "terms 只收录 AI 和机器学习领域的专有概念，包括模型、训练、推理、评测、智能体和检索增强生成相关术语。",
        "不要把通用编程、软件工程、数据库、浏览器、网络协议或互联网产品词汇放入 terms。",
        "只返回 JSON，不要 Markdown 或解释。",
        '格式：{"items":[{"id":"原 id","translation":"中文译文","terms":[{"source":"英文术语","target":"中文术语"}]}]}。',
        lockedTerms ? `必须沿用以下已锁定术语：\n${lockedTerms}` : ""
      ].filter(Boolean).join("\n")
    },
    {
      role: "user",
      content: JSON.stringify({ title, segments })
    }
  ];
}

export function parseTranslationResponse(raw, expectedIds = []) {
  if (typeof raw !== "string" || !raw.trim()) {
    throw new Error("翻译服务没有返回内容");
  }

  const cleaned = raw.trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const parsed = JSON.parse(cleaned);
  if (!Array.isArray(parsed.items)) {
    throw new Error("翻译结果格式不正确");
  }

  const expected = new Set(expectedIds.map(String));
  const seen = new Set();
  const items = parsed.items.map((item) => {
    const id = String(item.id ?? "");
    if (!id || seen.has(id) || (expected.size && !expected.has(id)) || typeof item.translation !== "string") {
      throw new Error("翻译结果缺少对应段落");
    }
    seen.add(id);
    return {
      id,
      translation: item.translation.trim(),
      terms: normalizeTerms(item.terms)
    };
  });
  if (expected.size && (seen.size !== expected.size || [...expected].some((id) => !seen.has(id)))) {
    throw new Error("翻译结果缺少对应段落");
  }
  return items;
}

export function normalizeTerms(terms) {
  if (!Array.isArray(terms)) return [];
  const seen = new Set();
  return terms.flatMap((term) => {
    const source = typeof term?.source === "string" ? term.source.trim() : "";
    const target = typeof term?.target === "string" ? term.target.trim() : "";
    const normalizedSource = source.toLocaleLowerCase();
    const key = `${normalizedSource}\u0000${target}`;
    if (!source || !target || NON_AI_TERMS.has(normalizedSource) || seen.has(key)) return [];
    seen.add(key);
    return [{ source, target }];
  });
}

export function getDefaultModel() {
  return DEFAULT_MODEL;
}
