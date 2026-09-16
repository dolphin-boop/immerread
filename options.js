import { CACHE_STORAGE_KEY } from "./lib/cache.js";
import { SUMMARY_STORAGE_KEY } from "./lib/summary.js";
import { DEFAULT_API_BASE, getDefaultModel } from "./lib/translation.js";

const form = document.getElementById("settingsForm");
const apiKey = document.getElementById("apiKey");
const model = document.getElementById("model");
const modelHint = document.getElementById("modelHint");
const apiUrl = document.getElementById("apiUrl");
const status = document.getElementById("status");
const clearCache = document.getElementById("clearCache");
const cacheStatus = document.getElementById("cacheStatus");
const fieldset = form.querySelector("fieldset");

const LEGACY_MODELS = new Set(["deepseek-chat", "deepseek-reasoner"]);

loadSettings();

async function loadSettings() {
  try {
    const settings = await chrome.storage.local.get(["deepseekApiKey", "deepseekModel", "deepseekApiUrl"]);
    apiKey.value = settings.deepseekApiKey || "";
    model.value = settings.deepseekModel || getDefaultModel();
    apiUrl.value = settings.deepseekApiUrl || DEFAULT_API_BASE;
    if (LEGACY_MODELS.has(model.value.trim())) {
      modelHint.textContent = `旧模型名 ${model.value.trim()} 已由 deepseek-flash 取代，建议改后保存；请求失败时请先改这里。`;
      modelHint.classList.add("warning");
    }
    status.textContent = settings.deepseekApiKey ? "已读取保存的 API Key。" : "请填写 API Key 后保存。";
  } catch {
    status.textContent = "读取设置失败，请重新加载扩展。";
  } finally {
    fieldset.disabled = false;
    form.setAttribute("aria-busy", "false");
  }
}

form.addEventListener("submit", (event) => event.preventDefault());

let saveTimer = 0;
function scheduleSave() {
  if (fieldset.disabled) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveSettings, 400);
}
for (const field of [apiKey, model, apiUrl]) {
  field.addEventListener("input", scheduleSave);
}

async function saveSettings() {
  const values = {
    deepseekApiKey: apiKey.value.trim(),
    deepseekModel: model.value.trim() || getDefaultModel(),
    deepseekApiUrl: apiUrl.value.trim() || DEFAULT_API_BASE
  };
  status.textContent = "正在保存…";
  try {
    await chrome.storage.local.set(values);
    const saved = await chrome.storage.local.get(["deepseekApiKey", "deepseekModel", "deepseekApiUrl"]);
    if (saved.deepseekApiKey !== values.deepseekApiKey || saved.deepseekModel !== values.deepseekModel ||
      saved.deepseekApiUrl !== values.deepseekApiUrl) {
      throw new Error("保存校验失败");
    }
    status.textContent = "已自动保存，关闭页面后仍会保留。";
  } catch {
    status.textContent = "保存失败，请重新加载扩展后再试。";
  }
}

clearCache.addEventListener("click", async () => {
  clearCache.disabled = true;
  cacheStatus.textContent = "正在清除…";
  try {
    await chrome.storage.local.remove([CACHE_STORAGE_KEY, SUMMARY_STORAGE_KEY]);
    cacheStatus.textContent = "缓存已清除，重新打开文章将重新翻译。";
  } catch {
    cacheStatus.textContent = "清除失败，请重试。";
  } finally {
    clearCache.disabled = false;
  }
});
