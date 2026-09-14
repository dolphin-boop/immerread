import {
  CACHE_STORAGE_KEY,
  mergeCachedItems,
  readCachedItems
} from "./lib/cache.js";
import {
  buildTranslationMessages,
  getDefaultModel,
  parseTranslationResponse
} from "./lib/translation.js";

let cacheWriteChain = Promise.resolve();

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id || !tab.url || !/^https?:/i.test(tab.url)) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "YIDU_START" });
  } catch {
    try {
      await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ["content.css"] });
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
      await chrome.tabs.sendMessage(tab.id, { type: "YIDU_START" });
    } catch {
      // Chrome 内部页面等不允许内容脚本运行。
    }
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "YIDU_OPEN_OPTIONS") {
    chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
    return false;
  }

  const handlers = {
    YIDU_TRANSLATE_BATCH: translateBatch,
    YIDU_CACHE_GET: getCachedTranslations,
    YIDU_CACHE_PUT: putCachedTranslations
  };
  const handler = handlers[message?.type];
  if (!handler) return false;
  handler(message.payload).then(sendResponse);
  return true;
});

async function getModel() {
  const settings = await chrome.storage.local.get("deepseekModel");
  return settings.deepseekModel || getDefaultModel();
}

async function getCachedTranslations(payload) {
  try {
    const stored = await chrome.storage.local.get(CACHE_STORAGE_KEY);
    const result = readCachedItems(stored[CACHE_STORAGE_KEY], {
      ...payload,
      model: await getModel()
    });
    return { ok: true, items: result.items };
  } catch {
    return { ok: true, items: [] };
  }
}

function putCachedTranslations(payload) {
  cacheWriteChain = cacheWriteChain.catch(() => undefined).then(async () => {
    const stored = await chrome.storage.local.get(CACHE_STORAGE_KEY);
    const cache = mergeCachedItems(stored[CACHE_STORAGE_KEY], {
      ...payload,
      model: await getModel()
    });
    await chrome.storage.local.set({ [CACHE_STORAGE_KEY]: cache });
    return { ok: true };
  });
  return cacheWriteChain.catch(() => ({ ok: false }));
}

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