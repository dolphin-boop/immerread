const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..");
const longText = "Long article paragraph with many sentences about evaluating autonomous agents. ".repeat(30);
const html = '<!doctype html><html lang="en"><head><title>Example article</title></head><body><main><h1 aria-label="Claude Fable 5.1 and Mythos 5.1"><span aria-hidden="true">:Claude: Fable 5.1</span><span aria-hidden="true">and Mythos 5.1</span></h1><p id="intro">Evaluation harnesses help teams measure agent performance.</p><section id="carousel" class="TestimonialCarousel-module-scss-module__o0jJtW__carousel"><button>Previous</button><div class="TestimonialCarousel-module-scss-module__o0jJtW__stage"><article class="TestimonialCarousel-module-scss-module__o0jJtW__card"><blockquote><p>It’s friendly Fable and it runs twice as fast as the previous model.</p></blockquote></article></div><button>Next</button></section><div id="grid" style="display:grid;grid-template-columns:1fr 1fr;gap:20px"><div><h3>Methods</h3><p>String matching checks cover exact patterns and binary tests for each task.</p></div><div><h3>Strengths</h3><p>They are fast and cheap while reproducible across several independent trials.</p></div></div><p>Good evaluations help teams ship agents more confidently.</p><p id="long">' + longText + '</p></main></body></html>';
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
          const input = JSON.parse(request.messages[1].content);
          const items = input.segments.map((segment) => ({
            id: segment.id, translation: "译文：" + segment.text, terms: []
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
    assert.ok(!extracted.article.segments.some((segment) => segment.text.includes("String matching checks")));
    assert.ok(!extracted.article.segments.some((segment) => segment.text.includes("friendly Fable")));
    assert.equal(await page.locator("#grid").count(), 1, "原文复杂模块仍须存在");
    assert.equal(await page.locator("#carousel").count(), 1, "原文轮播仍须存在");
    const extensionOrigin = worker.url().match(/^(chrome-extension:\/\/[^/]+)/)[1];
    const panel = await context.newPage();
    await panel.goto(extensionOrigin + "/sidepanel.html");
    await panel.locator(".yidu-skipped").first().waitFor();
    await panel.locator(".yidu-h1[data-translated=\"true\"]").waitFor();
    assert.ok(!(await panel.locator(".yidu-h1").textContent()).includes(":Claude:"));
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
    assert.deepEqual(await page.locator("#yidu-selection-root .yidu-menu button").allTextContents(), ["翻译", "解释"]);
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
    await worker.evaluate(async () => chrome.storage.local.remove("deepseekApiKey"));
    await selectIntro();
    await page.locator("#yidu-selection-root .yidu-menu button").first().click();
    await page.locator("#yidu-selection-root .yidu-error").filter({ hasText: "DeepSeek API Key" }).waitFor();
    assert.equal(await page.locator("#yidu-selection-root .yidu-settings").textContent(), "打开设置");
    console.log("选词翻译/解释、对应段落暖色标识及清除、长段落、复杂模块、缺少密钥：通过");
  } finally {
    await context?.close();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
