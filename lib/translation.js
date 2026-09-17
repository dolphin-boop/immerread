const DEFAULT_MODEL = "deepseek-flash";
export const DEFAULT_API_BASE = "https://api.deepseek.com";

export function normalizeApiBase(value) {
  try {
    const url = new URL(String(value || "").trim() || DEFAULT_API_BASE);
    if (!/^https?:$/i.test(url.protocol)) return DEFAULT_API_BASE;
    return (url.origin + decodeURI(url.pathname)).replace(/\/+$/, "");
  } catch {
    return DEFAULT_API_BASE;
  }
}

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
  const preparedSegments = segments.map(({ id, kind, text }) => ({ id, kind, text }));

  return [
    {
      role: "system",
      content: [
        "你是专业的英中技术文章翻译器，以地道中文为最高标准：译文应读上去像中文作者写的，而不是译出来的。",
        "忠实翻译，不增删信息；产品名、模型名、API 名称保持原文。",
        "先理解整个段落的语义、逻辑和语气，再按中文习惯重组句式；不要逐词直译或照搬英语语序。",
        "把英文抽象名词改写为中文动词或短句，避免名词堆砌（如 overhead 按语境译为“多花的功夫”，不译作“额外开销的负担”）。",
        "禁止三层以上的“的”字定语链；长定语拆成短句，先说主干再补充。",
        "少用“被”字被动，优先主动句、无主句或自然的话题句。",
        "不机械对应英文虚词：the/a 不必译成“这/一个”，of/for/with 不必都译成“的/对于/与”。",
        "seem like、may even、tend to 等弱化表达用“似乎”“可能”“往往”点到即可，不得堆叠成“可能看起来像是”。",
        "结合技术文章语境处理多义词和习惯搭配，选择自然准确的中文表达。",
        "输出前自行润色，消除生硬搭配、重复和翻译腔；不得省略事实、条件、转折或因果关系。",
        "示例：More rigorous evaluation may even seem like overhead that slows down shipping. ✗ 更严格的评估甚至可能看起来像是拖慢交付速度的额外负担。✓ 更严格的评估甚至显得多余，还会拖慢交付。",
        "translation 只输出纯文本译文，不得输出 HTML、Markdown 或其他样式标记。",
        "代码或标识符保持原文。",
        "terms 只收录 AI 和机器学习领域的专有概念，包括模型、训练、推理、评测、智能体和检索增强生成相关术语。",
        "不要把通用编程、软件工程、数据库、浏览器、网络协议或互联网产品词汇放入 terms。",
        "只返回 JSON，不要 Markdown 或解释。",
        '格式：{"items":[{"id":"原 id","translation":"纯文本中文译文","terms":[{"source":"英文术语","target":"中文术语"}]}]}。',
        lockedTerms ? `必须沿用以下已锁定术语：\n${lockedTerms}` : ""
      ].filter(Boolean).join("\n")
    },
    {
      role: "user",
      content: JSON.stringify({ title, segments: preparedSegments })
    }
  ];
}

export function parseTranslationResponse(raw, expectedIds = []) {
  if (typeof raw !== "string" || !raw.trim()) throw new Error("翻译服务没有返回内容");
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const parsed = JSON.parse(cleaned);
  if (!Array.isArray(parsed.items)) throw new Error("翻译结果格式不正确");

  const expected = new Set(expectedIds.map(String));
  const seen = new Set();
  const items = parsed.items.map((item) => {
    const id = String(item.id ?? "");
    if (!id || seen.has(id) || (expected.size && !expected.has(id)) || typeof item.translation !== "string") {
      throw new Error("翻译结果缺少对应段落");
    }
    seen.add(id);
    return { id, translation: item.translation.trim(), terms: normalizeTerms(item.terms) };
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
