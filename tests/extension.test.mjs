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

test("configures a local Manifest V3 side panel extension", async () => {
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
  assert.equal(manifest.icons["128"], "icons/icon-128.png");
  assert.equal(manifest.action.default_icon["32"], "icons/icon-32.png");
  for (const size of [16, 32, 48, 128]) {
    const file = await readFile(new URL(`icons/icon-${size}.png`, root));
    assert.ok(file.length > 0);
  }
  assert.match(background, /openPanelOnActionClick:\s*true/);
  assert.match(background, /chrome\.scripting\.executeScript/);
  assert.match(background, /YIDU_GLOSSARY_UPSERT/);
  assert.match(background, /glossaryForSegments/);
  assert.match(background, /normalizeApiBase/);
  assert.match(background, /deepseekApiUrl/);
  assert.match(background, /thinking:\s*\{\s*type:\s*"disabled"\s*\}/);
});

test("extracts article semantics without rebuilding the source page", () => {
  assert.match(content, /YIDU_GET_ARTICLE/);
  assert.match(content, /YIDU_SOURCE_SCROLL/);
  assert.match(content, /YIDU_SCROLL_TO_SEGMENT/);
  assert.match(content, /YIDU_SOURCE_SELECTION/);
  assert.match(content, /YIDU_REQUEST_SELECTION_SYNC/);
  assert.match(content, /固定译法/);
  assert.match(content, /overscroll-behavior:contain/);
  assert.match(content, /刷新当前网页后重试/);
  assert.match(content, /yidu-selection-root/);
  assert.match(content, /dismissSelectionUi/);
  assert.doesNotMatch(content, /className = "yidu-close"|close\.textContent = "×"/);
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
  assert.doesNotMatch(panelHtml, /AI 术语高亮|term-toggle/);
  assert.match(panelHtml, /tab-summary/);
  assert.match(panelHtml, />导读<\/button>/);
  assert.match(panelHtml, /tab-glossary/);
  assert.match(panelHtml, /glossary-form/);
  assert.doesNotMatch(panelHtml, /当前位置|已读/);
  assert.match(panelScript, /IntersectionObserver/);
  assert.match(panelScript, /handleSourceScroll/);
  assert.match(panelScript, /YIDU_REQUEST_SCROLL_SYNC/);
  assert.match(panelScript, /YIDU_REQUEST_SELECTION_SYNC/);
  assert.match(panelScript, /handleSourceSelection/);
  assert.match(panelScript, /handleGlossaryChanged/);
  assert.match(panelScript, /glossaryEpoch/);
  assert.match(panelScript, /current\.failedSegments\.splice\(0\)\.forEach\(\(segment\) => enqueue/);
  assert.doesNotMatch(panelScript, /if \(current\.failed\) return;/);
  assert.match(panelHtml, /type="module" src="sidepanel.js"/);
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
  assert.match(panelHtml, /role="tablist"/);
  assert.match(panelScript, /groupArticleModules/);
  assert.match(background, /YIDU_SUMMARIZE_MODULE/);
  assert.match(panelScript, /YIDU_SUMMARIZE_MODULE/);
  assert.match(panelScript, /YIDU_SCROLL_TO_SEGMENT/);
  assert.match(panelScript, /YIDU_GLOSSARY_GET/);
  assert.match(panelScript, /YIDU_GLOSSARY_DELETE/);
  assert.match(panelStyles, /\.yidu-summary-article-original/);
  assert.doesNotMatch(panelScript, /current\.article\.source|向下阅读继续翻译|已生成 .*导读模块/);
  assert.doesNotMatch(panelStyles, /\.yidu-summary-progress/);
  assert.doesNotMatch(panelScript, /highlightedText|termsVisible|term-toggle/);
});

test("keeps the panel readable and avoids prohibited visual shortcuts", () => {
  assert.match(panelStyles, /\.yidu-h1/);
  assert.match(panelStyles, /\.yidu-controls\{position:sticky;top:58px/);
  assert.doesNotMatch(panelStyles, /\.yidu-term\{|\.yidu-term-toggle/);
  assert.match(panelStyles, /\.yidu-blockquote/);
  assert.match(panelStyles, /\.yidu-list/);
  assert.match(panelStyles, /\.yidu-segment\.yidu-source-selected\{background:#f3e7da;border-radius:7px/);
  assert.doesNotMatch(panelStyles, /\.yidu-segment\.yidu-source-selected\{[^}]*border-left/);
  assert.doesNotMatch(panelStyles, /transition:\s*all/);
  assert.doesNotMatch(panelStyles, /font-style:\s*italic/);
  assert.doesNotMatch(panelStyles, /#[0]{6}\b/i);
  assert.doesNotMatch(panelStyles, /border-left:\s*[2-9]px/);
});

test("loads settings before enabling input and verifies persistence", () => {
  assert.match(optionsHtml, /<fieldset disabled>/);
  assert.match(optionsHtml, /aria-busy="true"/);
  assert.match(optionsHtml, /id="apiUrl"/);
  assert.match(optionsHtml, /id="clearCache"/);
  assert.match(optionsHtml, /type="module" src="options\.js"/);
  assert.match(optionsScript, /await chrome\.storage\.local\.get/);
  assert.match(optionsScript, /await chrome\.storage\.local\.set/);
  assert.match(optionsScript, /保存校验失败/);
  assert.match(optionsScript, /fieldset\.disabled = false/);
  assert.match(optionsScript, /deepseekApiUrl/);
  assert.match(optionsScript, /CACHE_STORAGE_KEY/);
  assert.match(optionsScript, /SUMMARY_STORAGE_KEY/);
  assert.match(optionsScript, /chrome\.storage\.local\.remove/);
});
