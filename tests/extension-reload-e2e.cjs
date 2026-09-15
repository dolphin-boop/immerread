const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("playwright");

const projectRoot = path.resolve(__dirname, "..");

async function findWorker(context, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const worker = context.serviceWorkers().find((item) => item.url().endsWith("/background.js"));
    if (worker) return worker;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("译读后台进程未启动");
}

const server = http.createServer((_request, response) => {
  const fixture = path.join(projectRoot, "tests", "fixtures", "long-article.html");
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  fs.createReadStream(fixture).pipe(response);
});

(async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "yidu-reconnect-e2e-"));
  const profile = path.join(tempRoot, "profile");
  const extensionRoot = path.join(tempRoot, "extension");
  let context;

  try {
    fs.cpSync(projectRoot, extensionRoot, {
      recursive: true,
      filter: (source) => {
        const relative = path.relative(projectRoot, source);
        return !relative.startsWith(".git") && !relative.startsWith("tests");
      }
    });
    const manifestPath = path.join(extensionRoot, "manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    delete manifest.content_scripts;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const articleUrl = "http://127.0.0.1:" + server.address().port + "/article";
    context = await chromium.launchPersistentContext(profile, {
      executablePath: process.env.YIDU_CHROMIUM_PATH,
      headless: false,
      viewport: { width: 1280, height: 720 },
      ignoreDefaultArgs: ["--disable-extensions"],
      args: [
        "--disable-extensions-except=" + extensionRoot,
        "--load-extension=" + extensionRoot,
        "--window-position=-32000,-32000"
      ]
    });

    const pages = context.pages();
    const articlePage = pages[0] || await context.newPage();
    await articlePage.goto(articleUrl, { waitUntil: "domcontentloaded" });

    const worker = await findWorker(context);
    const extensionOrigin = worker.url().match(/^(chrome-extension:\/\/[^/]+)/)?.[1];
    assert.ok(extensionOrigin, "无法确定扩展地址");

    const missingReceiver = await worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ url: "http://127.0.0.1/*" });
      try {
        await chrome.tabs.sendMessage(tab.id, { type: "YIDU_GET_ARTICLE" });
        return "connected";
      } catch (error) {
        return error.message;
      }
    });
    assert.match(missingReceiver, /Receiving end does not exist/);

    await worker.evaluate(async () => {
      await chrome.storage.local.set({
        deepseekApiKey: "test-only",
        deepseekModel: "deepseek-chat"
      });
      globalThis.__yiduFetchCalls = 0;
      globalThis.fetch = async (_url, options) => {
        globalThis.__yiduFetchCalls += 1;
        const request = JSON.parse(options.body);
        const input = JSON.parse(request.messages[1].content);
        const items = input.segments.map((segment) => ({
          id: segment.id,
          translation: "重连译文：" + (segment.markup || segment.text),
          terms: []
        }));
        return new Response(JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ items }) } }]
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      };
    });

    const panel = await context.newPage();
    await panel.setViewportSize({ width: 420, height: 720 });
    await panel.goto(extensionOrigin + "/sidepanel.html", { waitUntil: "domcontentloaded" });
    await panel.locator(".yidu-segment").first().waitFor({ state: "visible", timeout: 10_000 });
    await panel.waitForFunction(
      'document.querySelector(".yidu-segment[data-translated=\\"true\\"]")'
    );

    assert.equal(await panel.locator(".yidu-segment").count(), 96);
    assert.equal(await panel.getByText("Could not establish connection").count(), 0);
    assert.ok(await panel.getByText(/重连译文/).count() > 0);
    const initialTranslated = await panel.locator('.yidu-segment[data-translated="true"]').count();
    assert.ok(initialTranslated >= 4 && initialTranslated < 96, "长文应按视区渐进翻译");
    const rich = panel.locator('[data-segment-id="s3"]');
    await rich.locator("strong").waitFor();
    assert.equal(await rich.locator("u").count(), 1);
    assert.equal(await rich.locator("code").textContent(), "model_id");
    await articlePage.evaluate(() => {
      document.documentElement.style.scrollBehavior = "auto";
      window.scrollTo(0, document.documentElement.scrollHeight);
    });
    await panel.waitForFunction(() => window.scrollY > 100);
    await panel.waitForFunction(() => [...document.querySelectorAll(".yidu-segment")].at(-1)?.dataset.translated === "true");
    const callsBeforeReload = await worker.evaluate(() => globalThis.__yiduFetchCalls);
    assert.ok(callsBeforeReload >= 2);
    await panel.reload();
    await panel.locator(".yidu-segment").first().waitFor();
    await panel.waitForFunction(() => document.querySelectorAll('.yidu-segment[data-translated="true"]').length >= 4);
    await panel.waitForTimeout(400);
    assert.equal(await worker.evaluate(() => globalThis.__yiduFetchCalls), callsBeforeReload, "刷新侧栏应复用段落缓存");
    console.log("PASS: side panel reinjects when the article has no message receiver");
  } finally {
    if (context) await context.close();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});