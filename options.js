const form = document.getElementById("settingsForm");
const apiKey = document.getElementById("apiKey");
const model = document.getElementById("model");
const status = document.getElementById("status");
const fieldset = form.querySelector("fieldset");

loadSettings();

async function loadSettings() {
  try {
    const settings = await chrome.storage.local.get(["deepseekApiKey", "deepseekModel"]);
    apiKey.value = settings.deepseekApiKey || "";
    model.value = settings.deepseekModel || "deepseek-chat";
    status.textContent = settings.deepseekApiKey ? "已读取保存的 API Key。" : "请填写 API Key 后保存。";
  } catch {
    status.textContent = "读取设置失败，请重新加载扩展。";
  } finally {
    fieldset.disabled = false;
    form.setAttribute("aria-busy", "false");
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const values = {
    deepseekApiKey: apiKey.value.trim(),
    deepseekModel: model.value.trim() || "deepseek-chat"
  };
  fieldset.disabled = true;
  status.textContent = "正在保存…";
  try {
    await chrome.storage.local.set(values);
    const saved = await chrome.storage.local.get(["deepseekApiKey", "deepseekModel"]);
    if (saved.deepseekApiKey !== values.deepseekApiKey || saved.deepseekModel !== values.deepseekModel) {
      throw new Error("保存校验失败");
    }
    status.textContent = "设置已保存，关闭页面后仍会保留。";
  } catch {
    status.textContent = "保存失败，请重新加载扩展后再试。";
  } finally {
    fieldset.disabled = false;
    apiKey.focus();
  }
});
