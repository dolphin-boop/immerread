import {
  buildTranslationMessages,
  getDefaultModel,
  parseTranslationResponse
} from "./lib/translation.js";

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "YIDU_START" });
  } catch {
    // Chrome 内部页面等不允许内容脚本运行。
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "YIDU_OPEN_OPTIONS") {
    chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type !== "YIDU_TRANSLATE_BATCH") return false;
  translateBatch(message.payload).then(sendResponse);
  return true;
});

async function translateBatch(payload) {
  try {
    const settings = await chrome.storage.local.get(["deepseekApiKey", "deepseekModel"]);
    if (!settings.deepseekApiKey) {
      return { ok: false, code: "SETUP_REQUIRED", message: "请先在设置中填写 DeepSeek API Key。" };
    }

    const segments = Array.isArray(payload?.segments) ? payload.segments : [];
    if (!segments.length) {
      return { ok: false, code: "EMPTY_BATCH", message: "没有可翻译的文章段落。" };
    }

    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${settings.deepseekApiKey}`
      },
      body: JSON.stringify({
        model: settings.deepseekModel || getDefaultModel(),
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: buildTranslationMessages(payload)
      })
    });

    if (!response.ok) {
      const detail = await response.json().catch(() => null);
      throw new Error(detail?.error?.message || `DeepSeek 请求失败（${response.status}）`);
    }

    const body = await response.json();
    const raw = body?.choices?.[0]?.message?.content;
    return {
      ok: true,
      items: parseTranslationResponse(raw, segments.map((segment) => segment.id))
    };
  } catch (error) {
    return { ok: false, code: "TRANSLATION_FAILED", message: error?.message || "翻译失败，请稍后重试。" };
  }
}
