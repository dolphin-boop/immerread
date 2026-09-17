import { buildSelectionMessages, cleanSelectionResponse } from "./lib/selection.js";
import { GLOSSARY_STORAGE_KEY, glossaryForSegments, missingFixedTerms, prepareFixedTermRetry, restoreFixedTermRetry, removeGlossaryEntry, upsertGlossary } from "./lib/glossary.js";
import {
  CACHE_STORAGE_KEY,
  mergeCachedItems,
  readCachedItems
} from "./lib/cache.js";
import {
  buildTranslationMessages,
  getDefaultModel,
  normalizeApiBase,
  parseTranslationResponse
} from "./lib/translation.js";
import { SUMMARY_STORAGE_KEY, buildSummaryMessages, makeSummaryKey, parseSummaryResponse, readCachedSummary, saveCachedSummary } from "./lib/summary.js";

let cacheWriteChain = Promise.resolve();
let glossaryWriteChain = Promise.resolve();
let summaryWriteChain = Promise.resolve();

void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);

const panelOpenTabs = new Set();

chrome.runtime.onConnect.addListener((port) => {
  const match = /^yidu-panel-open:(\d+)$/.exec(port.name || "");
  if (!match) return;
  const tabId = Number(match[1]);
  panelOpenTabs.add(tabId);
  notifyPanelState(tabId, true);
  port.onDisconnect.addListener(() => {
    panelOpenTabs.delete(tabId);
    notifyPanelState(tabId, false);
  });
});

function notifyPanelState(tabId, open) {
  chrome.tabs.sendMessage(tabId, { type: "YIDU_PANEL_STATE", payload: { open } }).catch(() => undefined);
}

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") void chrome.runtime.openOptionsPage();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "YIDU_OPEN_OPTIONS") {
    chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type === "YIDU_PANEL_STATE_QUERY") {
    sendResponse({ ok: true, open: panelOpenTabs.has(sender.tab?.id) });
    return false;
  }

  const handlers = {
    YIDU_PREPARE_TAB: prepareTab,
    YIDU_TRANSLATE_BATCH: translateBatch,
    YIDU_SELECTION_ACTION: selectionAction,
    YIDU_GLOSSARY_UPSERT: saveGlossaryEntry,
    YIDU_GLOSSARY_GET: getGlossaryEntries,
    YIDU_GLOSSARY_DELETE: deleteGlossaryEntry,
    YIDU_SUMMARIZE_MODULE: summarizeModule,
    YIDU_CACHE_GET: getCachedTranslations,
    YIDU_CACHE_PUT: putCachedTranslations
  };
  const handler = handlers[message?.type];
  if (!handler) return false;
  Promise.resolve(handler(message.payload)).then(sendResponse);
  return true;
});

async function prepareTab(payload) {
  try {
    const tabId = Number(payload?.tabId);
    const tab = await chrome.tabs.get(tabId);
    if (!Number.isInteger(tabId) || !/^https?:/i.test(tab.url || "")) {
      return { ok: false, message: "当前页面不支持文章翻译。" };
    }
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
    return { ok: true };
  } catch {
    return { ok: false, message: "无法读取当前页面，请刷新页面后重试。" };
  }
}

async function getModel() {
  const settings = await chrome.storage.local.get("deepseekModel");
  return settings.deepseekModel || getDefaultModel();
}

async function chatCompletions(settings, body) {
  const endpoint = normalizeApiBase(settings?.deepseekApiUrl) + "/chat/completions";
  const send = (extra) => fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.deepseekApiKey}`
    },
    body: JSON.stringify({ ...body, ...extra })
  });
  const response = await send({ thinking: { type: "disabled" } });
  if (response.status === 400) {
    const detail = await response.clone().json().catch(() => null);
    if (/thinking/i.test(JSON.stringify(detail || ""))) return send({});
  }
  return response;
}

async function getCachedTranslations(payload) {
  try {
    const stored = await chrome.storage.local.get([CACHE_STORAGE_KEY, GLOSSARY_STORAGE_KEY]);
    const result = readCachedItems(stored[CACHE_STORAGE_KEY], {
      ...payload,
      model: await getModel(),
      glossary: stored[GLOSSARY_STORAGE_KEY]
    });
    return { ok: true, items: result.items };
  } catch {
    return { ok: true, items: [] };
  }
}

function putCachedTranslations(payload) {
  cacheWriteChain = cacheWriteChain.catch(() => undefined).then(async () => {
    const stored = await chrome.storage.local.get([CACHE_STORAGE_KEY, GLOSSARY_STORAGE_KEY]);
    const cache = mergeCachedItems(stored[CACHE_STORAGE_KEY], {
      ...payload,
      model: await getModel(),
      glossary: payload?.glossarySnapshot || stored[GLOSSARY_STORAGE_KEY]
    });
    await chrome.storage.local.set({ [CACHE_STORAGE_KEY]: cache });
    return { ok: true };
  });
  return cacheWriteChain.catch(() => ({ ok: false }));
}

async function translateBatch(payload) {
  try {
    const settings = await chrome.storage.local.get(["deepseekApiKey", "deepseekModel", "deepseekApiUrl", GLOSSARY_STORAGE_KEY]);
    if (!settings.deepseekApiKey) {
      return { ok: false, code: "SETUP_REQUIRED", message: "请先在设置中填写 DeepSeek API Key。" };
    }

    const segments = Array.isArray(payload?.segments) ? payload.segments : [];
    if (!segments.length) {
      return { ok: false, code: "EMPTY_BATCH", message: "没有可翻译的文章内容。" };
    }

    const fixedGlossary = settings[GLOSSARY_STORAGE_KEY] || { version: 1, entries: {} };
    const glossary = {
      ...(payload?.glossary || {}),
      ...glossaryForSegments(fixedGlossary, segments)
    };

    async function requestTranslations(requestSegments, protectTerms = false) {
      const messages = buildTranslationMessages({ ...payload, segments: requestSegments, glossary });
      if (protectTerms) {
        messages[0].content += "\n原文中的 __YIDU_TERM_数字_数字__ 是固定译法占位符。translation 中必须原样保留全部占位符，不要翻译、替换或删除；扩展会在返回后填入用户指定译法。";
      }
      const response = await chatCompletions(settings, {
        model: settings.deepseekModel || getDefaultModel(),
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages
      });
      if (!response.ok) {
        const detail = await response.json().catch(() => null);
        throw new Error(detail?.error?.message || `DeepSeek 请求失败（${response.status}）`);
      }
      const body = await response.json();
      try {
        return parseTranslationResponse(body?.choices?.[0]?.message?.content, requestSegments.map((segment) => segment.id));
      } catch (error) {
        if (requestSegments.length < 2) throw error;
        const middle = Math.ceil(requestSegments.length / 2);
        const first = await requestTranslations(requestSegments.slice(0, middle), protectTerms);
        const second = await requestTranslations(requestSegments.slice(middle), protectTerms);
        return first.concat(second);
      }
    }

    let items = await requestTranslations(segments);
    const missing = missingFixedTerms(fixedGlossary, segments, items);
    if (missing.length) {
      const retryIds = new Set(missing.map((term) => term.id));
      const retryOriginal = segments.filter((segment) => retryIds.has(String(segment.id)));
      const retry = prepareFixedTermRetry(fixedGlossary, retryOriginal);
      const retried = await requestTranslations(retry.segments, true);
      const initialById = new Map(items.map((item) => [String(item.id), item]));
      const repaired = restoreFixedTermRetry(retried, retry.replacements, initialById);
      const byId = new Map(repaired.map((item) => [item.id, item]));
      items = items.map((item) => byId.get(item.id) || item);
    }
    return { ok: true, items, glossarySnapshot: fixedGlossary };
  } catch (error) {
    return { ok: false, code: "TRANSLATION_FAILED", message: error?.message || "翻译失败，请稍后重试。" };
  }
}
function saveGlossaryEntry(payload) {
  glossaryWriteChain = glossaryWriteChain.catch(() => undefined).then(async () => {
    try {
      const stored = await chrome.storage.local.get(GLOSSARY_STORAGE_KEY);
      const updated = upsertGlossary(stored[GLOSSARY_STORAGE_KEY], payload?.source, payload?.target);
      await chrome.storage.local.set({ [GLOSSARY_STORAGE_KEY]: updated });
      void chrome.runtime.sendMessage({
        type: "YIDU_GLOSSARY_CHANGED",
        payload: { source: payload.source, target: payload.target }
      }).catch(() => undefined);
      return { ok: true, entry: updated.entries[String(payload.source).trim().toLocaleLowerCase()] };
    } catch (error) {
      return { ok: false, message: error?.message || "保存指定译法失败，请重试。" };
    }
  });
  return glossaryWriteChain;
}

async function getGlossaryEntries() {
  await glossaryWriteChain.catch(() => undefined);
  const stored = await chrome.storage.local.get(GLOSSARY_STORAGE_KEY);
  return { ok: true, entries: Object.values(stored[GLOSSARY_STORAGE_KEY]?.entries || {}) };
}

function deleteGlossaryEntry(payload) {
  glossaryWriteChain = glossaryWriteChain.catch(() => undefined).then(async () => {
    try {
      const stored = await chrome.storage.local.get(GLOSSARY_STORAGE_KEY);
      const { glossary, removed } = removeGlossaryEntry(stored[GLOSSARY_STORAGE_KEY], payload?.source);
      if (!removed) return { ok: false, message: "这条固定译法已不存在。" };
      await chrome.storage.local.set({ [GLOSSARY_STORAGE_KEY]: glossary });
      void chrome.runtime.sendMessage({
        type: "YIDU_GLOSSARY_CHANGED",
        payload: { source: removed.source, target: null }
      }).catch(() => undefined);
      return { ok: true };
    } catch (error) {
      return { ok: false, message: error?.message || "删除固定译法失败，请重试。" };
    }
  });
  return glossaryWriteChain;
}

async function summarizeModule(payload) {
  try {
    const module = payload?.module;
    const segments = module?.segments;
    if (!Array.isArray(segments) || !segments.length ||
      segments.some((segment) => typeof segment?.text !== "string" || !segment.text.trim()) ||
      segments.reduce((count, segment) => count + segment.text.length, 0) > 10000) {
      return { ok: false, message: "当前模块内容无法总结。" };
    }
    const settings = await chrome.storage.local.get(["deepseekApiKey", "deepseekModel", "deepseekApiUrl", SUMMARY_STORAGE_KEY]);
    const model = settings.deepseekModel || getDefaultModel();
    const key = makeSummaryKey(payload?.url, module, model, payload?.title);
    const cached = readCachedSummary(settings[SUMMARY_STORAGE_KEY], key);
    if (cached) return { ok: true, result: cached, cached: true };
    if (!settings.deepseekApiKey) {
      return { ok: false, code: "SETUP_REQUIRED", message: "请先在设置中填写 DeepSeek API Key。" };
    }
    const response = await chatCompletions(settings, {
      model,
      temperature: 0.2,
      max_tokens: 1200,
      response_format: { type: "json_object" },
      messages: buildSummaryMessages({ articleTitle: payload?.title, module })
    });
    if (!response.ok) {
      const detail = await response.json().catch(() => null);
      throw new Error(detail?.error?.message || "DeepSeek 请求失败（" + response.status + "）");
    }
    const body = await response.json();
    const result = parseSummaryResponse(body?.choices?.[0]?.message?.content, module.title);
    summaryWriteChain = summaryWriteChain.catch(() => undefined).then(async () => {
      const stored = await chrome.storage.local.get(SUMMARY_STORAGE_KEY);
      await chrome.storage.local.set({
        [SUMMARY_STORAGE_KEY]: saveCachedSummary(stored[SUMMARY_STORAGE_KEY], key, result)
      });
    });
    const cacheSaved = await summaryWriteChain.then(() => true, () => false);
    return { ok: true, result, cached: false, cacheSaved };
  } catch (error) {
    return { ok: false, code: "SUMMARY_FAILED", message: error?.message || "导读生成失败，请重试。" };
  }
}

async function selectionAction(payload) {
  try {
    const messages = buildSelectionMessages(payload);
    const settings = await chrome.storage.local.get(["deepseekApiKey", "deepseekModel", "deepseekApiUrl"]);
    if (!settings.deepseekApiKey) {
      return { ok: false, code: "SETUP_REQUIRED", message: "请先在设置中填写 DeepSeek API Key。" };
    }
    const response = await chatCompletions(settings, {
      model: settings.deepseekModel || getDefaultModel(),
      temperature: 0.2,
      max_tokens: 512,
      messages
    });
    if (!response.ok) {
      const detail = await response.json().catch(() => null);
      throw new Error(detail?.error?.message || "DeepSeek 请求失败（" + response.status + "）");
    }
    const body = await response.json();
    return { ok: true, result: cleanSelectionResponse(body?.choices?.[0]?.message?.content) };
  } catch (error) {
    return { ok: false, code: "SELECTION_FAILED", message: error?.message || "请求失败，请稍后重试。" };
  }
}