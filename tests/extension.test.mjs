import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("manifest.json", root), "utf8"));
const background = await readFile(new URL("background.js", root), "utf8");
const content = await readFile(new URL("content.js", root), "utf8");
const panelHtml = await readFile(new URL("sidepanel.html", root), "utf8");
const panelScript = await readFile(new URL("sidepanel.js", root), "utf8");
const panelStyles = await readFile(new URL("sidepanel.css", root), "utf8");
const optionsHtml = await readFile(new URL("options.html", root), "utf8");
const optionsScript = await readFile(new URL("options.js", root), "utf8");

test("configures a local Manifest V3 side panel extension", () => {
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.minimum_chrome_version, "114");
  assert.equal(manifest.background.service_worker, "background.js");
  assert.equal(manifest.side_panel.default_path, "sidepanel.html");
  assert.equal(manifest.options_page, "options.html");
  assert.ok(manifest.permissions.includes("sidePanel"));
  assert.ok(manifest.permissions.includes("tabs"));
  assert.ok(manifest.host_permissions.includes("https://api.deepseek.com/*"));
  assert.ok(manifest.host_permissions.includes("http://*/*"));
  assert.ok(manifest.host_permissions.includes("https://*/*"));
  assert.match(background, /openPanelOnActionClick:\s*true/);
  assert.match(background, /chrome\.scripting\.executeScript/);
});

test("extracts article semantics without rebuilding the source page", () => {
  assert.match(content, /YIDU_GET_ARTICLE/);
  assert.match(content, /YIDU_SOURCE_SCROLL/);
  assert.match(content, /requestAnimationFrame/);
  assert.match(content, /h1, h2, h3, h4, h5, h6, p, blockquote, li/);
  assert.match(content, /<strong>/);
  assert.match(content, /<u>/);
  assert.match(content, /data-link/);
  assert.match(content, /<code>/);
  assert.match(content, /segments\.unshift\(titleSegment\)/);
  assert.match(content, /figure/);
  assert.doesNotMatch(content, /append\(root\)|documentElement\.style\.overflow/);
  assert.doesNotMatch(content, /segments\.length >= 64|totalCharacters \+ text\.length > 30000/);
});

test("renders progressive rich translations in the side panel", () => {
  assert.match(panelHtml, />中文翻译</);
  assert.match(panelHtml, /AI 术语高亮/);
  assert.doesNotMatch(panelHtml, /当前位置|已读/);
  assert.match(panelScript, /IntersectionObserver/);
  assert.match(panelScript, /handleSourceScroll/);
  assert.match(panelScript, /YIDU_REQUEST_SCROLL_SYNC/);
  assert.match(panelScript, /waitForTabReady/);
  assert.match(panelScript, /attempt < 3/);
  assert.match(panelScript, /页面连接失败，请刷新文章页面后重试/);
  assert.doesNotMatch(panelScript, /lastMessage = error\?\.message/);
  assert.match(panelScript, /YIDU_CACHE_GET/);
  assert.match(panelScript, /YIDU_CACHE_PUT/);
  assert.match(panelScript, /sanitizeNode/);
  assert.match(panelScript, /document\.createElement\("strong"\)/);
  assert.match(panelScript, /document\.createElement\("u"\)/);
  assert.match(panelScript, /document\.createElement\("a"\)/);
  assert.match(panelScript, /className = "yidu-emphasis"/);
  assert.match(panelHtml, /role="switch" aria-checked="false"/);
});

test("keeps the panel readable and avoids prohibited visual shortcuts", () => {
  assert.match(panelStyles, /\.yidu-h1/);
  assert.match(panelStyles, /\.yidu-blockquote/);
  assert.match(panelStyles, /\.yidu-list/);
  assert.doesNotMatch(panelStyles, /transition:\s*all/);
  assert.doesNotMatch(panelStyles, /font-style:\s*italic/);
  assert.doesNotMatch(panelStyles, /#[0]{6}\b/i);
  assert.doesNotMatch(panelStyles, /border-left:\s*[2-9]px/);
});

test("loads settings before enabling input and verifies persistence", () => {
  assert.match(optionsHtml, /<fieldset disabled>/);
  assert.match(optionsHtml, /aria-busy="true"/);
  assert.match(optionsScript, /await chrome\.storage\.local\.get/);
  assert.match(optionsScript, /await chrome\.storage\.local\.set/);
  assert.match(optionsScript, /保存校验失败/);
  assert.match(optionsScript, /fieldset\.disabled = false/);
});
