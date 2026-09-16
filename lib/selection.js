const LIMIT = 800;

export function normalizeSelectionPayload(payload) {
  const text = String(payload?.text || "").replace(/\s+/g, " ").trim().slice(0, LIMIT);


  const action = payload?.action === "explain" ? "explain" : payload?.action === "translate" ? "translate" : "";
  if (!action || !text || !/[A-Za-z]/.test(text)) throw new Error("请先选中英文内容。");
  return { action, text };
}

export function buildSelectionMessages(payload) {
  const { action, text } = normalizeSelectionPayload(payload);
  const system = action === "explain"
    ? "你是英文文章阅读助手。用中文解释用户选中的内容。术语给出简明定义，观点或句子解释其含义。只输出 1–3 句，具体、准确，不扩展无关背景，不重复原文，不编造事实。"
    : "你是英文文章翻译助手。把选中的英文忠实翻译为地道中文：像中文母语者重写这句话，而不是逐词对应。保留原意、专有名词和语气；按中文习惯重组语序，抽象名词改写为动词或短句，避免冗长的“的”字定语链和“被”字句；seem like、may even 等弱化表达点到即可，不要堆叠。只输出译文，不解释，不增加标题或前言。";
  const user = "选中的英文：" + text;
  return [{ role: "system", content: system }, { role: "user", content: user }];
}

export function cleanSelectionResponse(value) {
  const result = String(value || "").trim().slice(0, 1600);
  if (!result) throw new Error("模型未返回内容，请重试。");
  return result;
}
