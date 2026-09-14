const form = document.getElementById("settingsForm");
const apiKey = document.getElementById("apiKey");
const model = document.getElementById("model");
const status = document.getElementById("status");

chrome.storage.local.get(["deepseekApiKey", "deepseekModel"]).then((settings) => {
  apiKey.value = settings.deepseekApiKey || "";
  model.value = settings.deepseekModel || "deepseek-chat";
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  await chrome.storage.local.set({
    deepseekApiKey: apiKey.value.trim(),
    deepseekModel: model.value.trim() || "deepseek-chat"
  });
  status.textContent = "设置已保存。";
  window.setTimeout(() => { status.textContent = ""; }, 2400);
});
