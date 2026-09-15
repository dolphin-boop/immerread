const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..");
const longText = "Long article paragraph with many sentences about evaluating autonomous agents. ".repeat(30);
const html = '<!doctype html><html lang="en"><head><title>Example article</title></head><body><main><h1><span aria-hidden="true">:</span><span>Claude Fable 5.1 and Mythos 5.1</span></h1><h2 id="agents-heading">:Demystifying evals for AI agents</h2><p id="intro">Evaluation harnesses help teams measure agent performance.</p><section id="carousel" class="TestimonialCarousel-module-scss-module__o0jJtW__carousel"><button>Previous</button><div class="TestimonialCarousel-module-scss-module__o0jJtW__stage"><article class="TestimonialCarousel-module-scss-module__o0jJtW__card"><blockquote><p>It’s friendly Fable and it runs twice as fast as the previous model.</p></blockquote></article></div><button>Next</button></section><div id="grid" style="display:grid;grid-template-columns:1fr 1fr;gap:20px"><div><h3>Methods</h3><p>String matching checks cover exact patterns and binary tests for each task.</p></div><div><h3>Strengths</h3><p>They are fast and cheap while reproducible across several independent trials.</p></div></div><p id="plural">Good evaluations help teams ship agents more confidently.</p><p id="long">' + longText + '</p></main></body></html>';
const server = http.createServer((_request, response) => {
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  response.end(html);
});

(async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "yidu-selection-e2e-"));
  let context;
  try {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    context = await chromium.launchPersistentContext(path.join(tempRoot, "profile"), {
      executablePath: process.env.YIDU_CHROMIUM_PATH,
      headless: false,
      viewport: { width: 1280, height: 720 },
      ignoreDefaultArgs: ["--disable-extensions"],
      args: [
        "--disable-extensions-except=" + root,
        "--load-extension=" + root,
        "--window-position=-32000,-32000"
      ]
    });
    const page = context.pages()[0] || await context.newPage();
    await page.goto("http://127.0.0.1:" + server.address().port + "/article");
    const worker = await context.waitForEvent("serviceworker", { timeout: 10000 }).catch(() =>
      context.serviceWorkers().find((item) => item.url().endsWith("/background.js")));
    assert.ok(worker, "扩展后台未启动");
    await worker.evaluate(async () => {
      await chrome.storage.local.set({ deepseekApiKey: "test-only", deepseekModel: "deepseek-chat" });
      globalThis.fetch = async (_url, options) => {
        const request = JSON.parse(options.body);
        if (request.response_format) {
          if (globalThis.yiduFailNextBatch) {
            globalThis.yiduFailNextBatch = false;
            return new Response(JSON.stringify({ error: { message: "临时连接失败" } }), { status: 503 });
          }
          const input = JSON.parse(request.messages[1].content);
          const locked = request.messages[0].content.includes("agent => 代理体");
          const pluralLocked = request.messages[0].content.includes("agents => agents");
          const protectedTerms = input.segments.some((segment) => segment.text.includes("__YIDU_TERM_"));
          if (protectedTerms) globalThis.yiduProtectedRetries = (globalThis.yiduProtectedRetries || 0) + 1;
          if (locked) await new Promise((resolve) => setTimeout(resolve, 400));
          const items = input.segments.map((segment) => ({
            id: segment.id,
            translation: (segment.kind === "h1" ? ":" : "") + (protectedTerms ? "复数新译文：" : pluralLocked ? "复数旧译文：" : locked ? "新术语译文：" : "译文：")
              + (locked && !pluralLocked ? segment.text.replace(/\bagent\b/gi, "代理体") : segment.text.replace(/\bagents\b/gi, "智能体们")),
            terms: []
          }));
          return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ items }) } }] }), { status: 200 });
        }
        const content = request.messages[0].content.includes("中文解释") ? "智能体评测的简短解释。" : "评测框架。";

        return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
      };
    });

    const extracted = await worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ url: "http://127.0.0.1/*" });
      return chrome.tabs.sendMessage(tab.id, { type: "YIDU_GET_ARTICLE" });
    });
    assert.ok(extracted.ok);
    assert.equal(extracted.article.segments.filter((segment) => segment.kind === "skipped").length, 2);
    assert.equal(extracted.article.segments.find((segment) => segment.kind === "h1").text, "Claude Fable 5.1 and Mythos 5.1");
    assert.equal(extracted.article.segments.find((segment) => segment.kind === "h2").text, "Demystifying evals for AI agents");
    assert.equal(extracted.article.segments.find((segment) => segment.kind === "h2").markup, "Demystifying evals for AI agents");
    assert.ok(!extracted.article.segments.some((segment) => segment.text.includes("String matching checks")));
    assert.ok(!extracted.article.segments.some((segment) => segment.text.includes("friendly Fable")));
    assert.equal(await page.locator("#grid").count(), 1, "原文复杂模块仍须存在");
    assert.equal(await page.locator("#carousel").count(), 1, "原文轮播仍须存在");
    const extensionOrigin = worker.url().match(/^(chrome-extension:\/\/[^/]+)/)[1];
    const panel = await context.newPage();
    await panel.goto(extensionOrigin + "/sidepanel.html");
    await panel.locator(".yidu-skipped").first().waitFor();
    await panel.locator(".yidu-h1[data-translated=\"true\"]").waitFor();
    assert.doesNotMatch(await panel.locator(".yidu-h1").textContent(), /^\s*[:：]/);
    assert.equal(await panel.locator(".yidu-skipped").count(), 2);
    assert.equal(await panel.locator(".yidu-skipped").first().getAttribute("aria-busy"), null);
    assert.match(await panel.locator(".yidu-skipped").first().textContent(), /复杂模块保留在原文中/);
    assert.equal(await panel.getByText("String matching checks", { exact: false }).count(), 0);
    assert.equal(await panel.getByText("friendly Fable", { exact: false }).count(), 0);
    const longIndex = extracted.article.segments.findIndex((segment) => segment.text.startsWith("Long article paragraph"));
    const longIds = extracted.article.segments.slice(longIndex).map((segment) => segment.id);
    assert.ok(longIndex > 0 && longIds.length > 1, "长段落应拆分为多条译文");


    async function selectIntro() {
      await page.evaluate(() => {
        const node = document.querySelector("#intro").firstChild;
        const range = document.createRange();
        range.selectNodeContents(node);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      });
      await page.locator("#yidu-selection-root .yidu-menu button").first().waitFor();
    }

    await selectIntro();
    await panel.locator(".yidu-source-selected").waitFor();
    assert.equal(await panel.locator(".yidu-source-selected").count(), 1);
    assert.equal(await panel.locator(".yidu-source-selected").first().getAttribute("data-segment-id"), extracted.article.segments.find((segment) => segment.text.startsWith("Evaluation harnesses")).id);
    assert.equal(await panel.locator(".yidu-source-selected").first().evaluate((row) => getComputedStyle(row).backgroundColor), "rgb(243, 231, 218)");
    assert.deepEqual(await page.locator("#yidu-selection-root .yidu-menu button").allTextContents(), ["翻译", "解释", "固定译法"]);
    await page.locator("#yidu-selection-root .yidu-menu button").first().click();

    await page.locator("#yidu-selection-root .yidu-body").filter({ hasText: "评测框架。" }).waitFor();
    assert.match(await page.locator("#yidu-selection-root .yidu-result").textContent(), /翻译/);
    await page.locator("#yidu-selection-root .yidu-close").click();
    assert.equal(await page.locator("#yidu-selection-root .yidu-result").count(), 0);

    await selectIntro();
    await page.locator("#yidu-selection-root .yidu-menu button").nth(1).click();
    await page.locator("#yidu-selection-root .yidu-body").filter({ hasText: "智能体评测的简短解释。" }).waitFor();
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#yidu-selection-root .yidu-result").count(), 0);
    await page.evaluate(() => {
      window.getSelection().removeAllRanges();
      document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    await panel.locator(".yidu-source-selected").first().waitFor({ state: "detached" });
    await page.evaluate(() => {
      const node = document.querySelector("#carousel blockquote p").firstChild;
      const range = document.createRange();
      range.selectNodeContents(node);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    await page.locator("#yidu-selection-root .yidu-menu button").first().waitFor();
    assert.equal(await panel.locator(".yidu-source-selected").count(), 0, "复杂模块不应误标识译文");
    await page.evaluate(() => {
      const node = document.querySelector("#long").firstChild;
      const range = document.createRange();
      range.setStart(node, node.length - 40);
      range.setEnd(node, node.length);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    await panel.locator(".yidu-source-selected").first().waitFor();
    assert.deepEqual(await panel.locator(".yidu-source-selected").evaluateAll((rows) => rows.map((row) => row.dataset.segmentId)), longIds);
    await page.evaluate(() => {
      window.getSelection().removeAllRanges();
      document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    await panel.locator(".yidu-source-selected").first().waitFor({ state: "detached" });
    const introId = extracted.article.segments.find((segment) => segment.text.startsWith("Evaluation harnesses")).id;
    await panel.locator(".yidu-segment[data-segment-id=\"" + introId + "\"][data-translated=\"true\"]").waitFor();
    await page.evaluate(() => {
      const node = document.querySelector("#intro").firstChild;
      const start = node.textContent.indexOf("agent");
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, start + "agent".length);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    await page.locator("#yidu-selection-root .yidu-menu button").nth(2).click();
    if (process.env.YIDU_GLOSSARY_SCREENSHOT) await page.screenshot({ path: process.env.YIDU_GLOSSARY_SCREENSHOT });
    await page.locator("#yidu-selection-root .yidu-glossary-form input").fill("代理体");
    await page.locator("#yidu-selection-root .yidu-save").click();
    await page.locator("#yidu-selection-root .yidu-feedback").filter({ hasText: "已保存" }).waitFor();
    const savedGlossary = await worker.evaluate(async () => {
      const stored = await chrome.storage.local.get("yiduGlossaryV1");
      return stored.yiduGlossaryV1;
    });
    assert.equal(savedGlossary.entries.agent.target, "代理体");
    await panel.locator(".yidu-segment[data-segment-id=\"" + introId + "\"].yidu-refreshing").waitFor();
    assert.match(await panel.locator(".yidu-segment[data-segment-id=\"" + introId + "\"]").textContent(), /^译文：/, "重翻过程中须保留旧译文");
    await panel.locator(".yidu-segment[data-segment-id=\"" + introId + "\"]").filter({ hasText: "新术语译文：" }).waitFor();
    const matchingCache = await worker.evaluate(async () => {
      for (let attempt = 0; attempt < 30; attempt += 1) {
        const stored = await chrome.storage.local.get("yiduTranslationCacheV1");
        const articles = Object.values(stored.yiduTranslationCacheV1?.articles || {});
        if (articles.some((article) => Object.values(article.entries || {})
          .some((entry) => entry.translation?.startsWith("新术语译文：")))) return true;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return false;
    });
    assert.equal(matchingCache, true, "术语更新后的右侧译文应写入缓存");
    const anotherArticle = await panel.evaluate(async () => chrome.runtime.sendMessage({
      type: "YIDU_TRANSLATE_BATCH",
      payload: {
        title: "Another article",
        segments: [{ id: "a1", kind: "paragraph", text: "An agent evaluates results.", markup: "An agent evaluates results." }],
        glossary: {}
      }
    }));
    assert.ok(anotherArticle.ok);
    assert.match(anotherArticle.items[0].translation, /新术语译文/, "新文章应沿用已保存术语");
    await page.locator("#yidu-selection-root .yidu-close").click();
    const headingId = extracted.article.segments.find((segment) => segment.text.startsWith("Demystifying evals for AI agents")).id;
    const pluralId = extracted.article.segments.find((segment) => segment.text.startsWith("Good evaluations")).id;
    await panel.locator('.yidu-segment[data-segment-id="' + headingId + '"][data-translated="true"]').waitFor();
    await panel.locator('.yidu-segment[data-segment-id="' + pluralId + '"][data-translated="true"]').waitFor();
    await worker.evaluate(() => { globalThis.yiduFailNextBatch = true; });
    await panel.evaluate(async () => chrome.runtime.sendMessage({ type: "YIDU_GLOSSARY_UPSERT", payload: { source: "agent", target: "代理体" } }));
    await panel.locator(".yidu-error").waitFor();
    await page.evaluate(() => {
      const node = document.querySelector("#plural").firstChild;
      const start = node.textContent.indexOf("agents");
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, start + "agents".length);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    await page.locator("#yidu-selection-root .yidu-menu button").nth(2).click();
    await page.locator("#yidu-selection-root .yidu-glossary-form input").fill("agents");
    await page.locator("#yidu-selection-root .yidu-save").click();
    await page.locator("#yidu-selection-root .yidu-feedback").filter({ hasText: "已保存" }).waitFor();
    await panel.locator('.yidu-segment[data-segment-id="' + pluralId + '"]').filter({ hasText: "复数新译文：Good evaluations help teams ship agents" }).waitFor();
    await panel.locator('.yidu-segment[data-segment-id="' + headingId + '"]').filter({ hasText: "复数新译文：Demystifying evals for AI agents" }).waitFor();
    await panel.locator(".yidu-error").waitFor({ state: "detached" });
    assert.ok(await worker.evaluate(() => globalThis.yiduProtectedRetries > 0), "模型首次忽略固定译法时应以占位符重试");
    assert.equal((await worker.evaluate(async () => (await chrome.storage.local.get("yiduGlossaryV1")).yiduGlossaryV1)).entries.agents.target, "agents");
    await page.locator("#yidu-selection-root .yidu-close").click();
    await worker.evaluate(async () => chrome.storage.local.remove("deepseekApiKey"));
    await selectIntro();
    await page.locator("#yidu-selection-root .yidu-menu button").first().click();
    await page.locator("#yidu-selection-root .yidu-error").filter({ hasText: "DeepSeek API Key" }).waitFor();
    assert.equal(await page.locator("#yidu-selection-root .yidu-settings").textContent(), "打开设置");
    await page.locator("#yidu-selection-root .yidu-close").click();
    await worker.evaluate(() => {
      setTimeout(() => chrome.runtime.reload(), 30);
      return true;
    });
    await page.waitForTimeout(700);
    await selectIntro();
    await page.locator("#yidu-selection-root .yidu-menu button").nth(1).click();
    await page.locator("#yidu-selection-root .yidu-body").filter({ hasText: "刷新当前网页后重试" }).waitFor();
    assert.equal(await page.locator("#yidu-selection-root .yidu-reload").textContent(), "刷新网页");
    assert.doesNotMatch(await page.locator("#yidu-selection-root .yidu-result").textContent(), /Extension context invalidated/);
    console.log("选词翻译/解释、固定译法跨文章沿用、右侧局部重翻及缓存、复杂模块：通过");
  } finally {
    await context?.close();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
