import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("manifest.json", root), "utf8"));
const content = await readFile(new URL("content.js", root), "utf8");
const styles = await readFile(new URL("content.css", root), "utf8");
const optionsHtml = await readFile(new URL("options.html", root), "utf8");
const optionsScript = await readFile(new URL("options.js", root), "utf8");

test("configures a local Manifest V3 Chrome extension", () => {
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.background.service_worker, "background.js");
  assert.equal(manifest.options_page, "options.html");
  assert.deepEqual(manifest.permissions, ["storage", "scripting", "activeTab"]);
  assert.ok(manifest.host_permissions.includes("https://api.deepseek.com/*"));
});

test("injects the reader when the current tab predates extension loading", async () => {
  const background = await readFile(new URL("background.js", root), "utf8");
  assert.match(background, /chrome\.scripting\.insertCSS/);
  assert.match(background, /chrome\.scripting\.executeScript/);
  assert.equal((background.match(/YIDU_START/g) ?? []).length, 2);
});
test("keeps the MVP reader focused on bilingual comparison", () => {
  assert.match(content, />双语对照</);
  assert.doesNotMatch(content, /仅中文|重新翻译/);
  assert.match(content, /YIDU_TRANSLATE_BATCH/);
  assert.match(content, /className = "yidu-term"/);
});

test("highlights terms without prohibited visual shortcuts", () => {
  assert.match(styles, /\.yidu-term\{/);
  assert.doesNotMatch(styles, /transition:\s*all/);
  assert.doesNotMatch(styles, /font-style:\s*italic/);
  assert.doesNotMatch(styles, /#[0]{6}\b/i);
  assert.doesNotMatch(styles, /border-left:\s*[2-9]px/);
});

test("loads settings before enabling input and verifies persistence", () => {
  assert.match(optionsHtml, /<fieldset disabled>/);
  assert.match(optionsHtml, /aria-busy="true"/);
  assert.match(optionsScript, /await chrome\.storage\.local\.get/);
  assert.match(optionsScript, /await chrome\.storage\.local\.set/);
  assert.match(optionsScript, /保存校验失败/);
  assert.match(optionsScript, /fieldset\.disabled = false/);
});
