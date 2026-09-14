const DEFAULT_MODEL = "deepseek-chat";

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
        "识别 AI、机器学习和软件工程专有名词，并在整篇文章中保持译法一致。",
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
  return parsed.items.map((item) => {
    const id = String(item.id ?? "");
    if (!id || (expected.size && !expected.has(id)) || typeof item.translation !== "string") {
      throw new Error("翻译结果缺少对应段落");
    }
    return {
      id,
      translation: item.translation.trim(),
      terms: normalizeTerms(item.terms)
    };
  });
}

export function normalizeTerms(terms) {
  if (!Array.isArray(terms)) return [];
  const seen = new Set();
  return terms.flatMap((term) => {
    const source = typeof term?.source === "string" ? term.source.trim() : "";
    const target = typeof term?.target === "string" ? term.target.trim() : "";
    const key = `${source.toLocaleLowerCase()}\u0000${target}`;
    if (!source || !target || seen.has(key)) return [];
    seen.add(key);
    return [{ source, target }];
  });
}

export function getDefaultModel() {
  return DEFAULT_MODEL;
}
