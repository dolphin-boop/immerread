import functools
import os
import tempfile
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

from playwright.sync_api import sync_playwright


PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        return


handler = functools.partial(QuietHandler, directory=PROJECT_ROOT)
server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
thread = threading.Thread(target=server.serve_forever, daemon=True)
thread.start()
fixture_url = f"http://127.0.0.1:{server.server_port}/tests/fixtures/long-article.html"
test_url = os.environ.get("YIDU_TEST_URL", fixture_url)
is_fixture = test_url == fixture_url

trigger_reader = """async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("Test tab was not found");
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "YIDU_START" });
  } catch {
    await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ["content.css"] });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
    await chrome.tabs.sendMessage(tab.id, { type: "YIDU_START" });
  }
}"""

try:
    with sync_playwright() as playwright:
        with tempfile.TemporaryDirectory(prefix="yidu-e2e-", ignore_cleanup_errors=True) as profile:
            context = playwright.chromium.launch_persistent_context(
                profile,
                channel="chromium",
                headless=True,
                viewport={"width": 1280, "height": 720},
                args=[
                    f"--disable-extensions-except={PROJECT_ROOT}",
                    f"--load-extension={PROJECT_ROOT}",
                ],
            )
            try:
                page = context.pages[0] if context.pages else context.new_page()
                page.goto(test_url, wait_until="domcontentloaded")

                deadline = time.monotonic() + 10
                worker = next((item for item in context.service_workers if item.url.endswith("/background.js")), None)
                while worker is None and time.monotonic() < deadline:
                    candidate = context.wait_for_event("serviceworker", timeout=2_000)
                    if candidate.url.endswith("/background.js"):
                        worker = candidate
                assert worker is not None, "译读后台进程未启动"
                worker.evaluate(
                    """async () => {
                      await chrome.storage.local.set({ deepseekApiKey: "test-only", deepseekModel: "deepseek-chat" });
                      globalThis.__yiduFetchCalls = 0;
                      globalThis.fetch = async (_url, options) => {
                        globalThis.__yiduFetchCalls += 1;
                        const request = JSON.parse(options.body);
                        const input = JSON.parse(request.messages[1].content);
                        const items = input.segments.map((segment) => ({
                          id: segment.id,
                          translation: `译文：${segment.text}`,
                          terms: segment.text.includes("AI agent")
                            ? [{ source: "AI agent", target: "AI 智能体" }]
                            : []
                        }));
                        return new Response(JSON.stringify({
                          choices: [{ message: { content: JSON.stringify({ items }) } }]
                        }), { status: 200, headers: { "Content-Type": "application/json" } });
                      };
                    }"""
                )
                page.reload(wait_until="domcontentloaded")
                worker.evaluate(trigger_reader)

                reader = page.locator("#yidu-article-reader")
                reader.wait_for(state="visible", timeout=10_000)
                row_count = page.locator(".yidu-pair").count()
                assert row_count == 90 if is_fixture else row_count > 64
                page.wait_for_function(
                    "document.querySelectorAll('.yidu-pair[data-translated=\"true\"]').length >= 3"
                )
                initial_translated = page.locator('.yidu-pair[data-translated="true"]').count()
                assert initial_translated < row_count, "首屏不应立即翻译整篇文章"

                toggle = reader.get_by_role("switch", name="专有名词高亮")
                assert toggle.get_attribute("aria-checked") == "false"
                toggle.click()
                assert toggle.get_attribute("aria-checked") == "true"
                toggle.click()
                assert toggle.get_attribute("aria-checked") == "false"

                reader.evaluate("element => { element.scrollTop = element.scrollHeight; }")
                page.locator(".yidu-pair").last.wait_for(state="visible")
                page.wait_for_function(
                    "document.querySelector('.yidu-pair:last-child')?.dataset.translated === 'true'"
                )
                time.sleep(0.3)
                calls_before_reopen = worker.evaluate("globalThis.__yiduFetchCalls")
                assert calls_before_reopen >= 2

                worker.evaluate(trigger_reader)
                reader.wait_for(state="detached")
                worker.evaluate(trigger_reader)
                reader.wait_for(state="visible")
                page.wait_for_function(
                    f"document.querySelectorAll('.yidu-pair[data-translated=\"true\"]').length >= {initial_translated}"
                )
                time.sleep(0.5)
                assert worker.evaluate("globalThis.__yiduFetchCalls") == calls_before_reopen
                assert "缓存" in reader.locator(".yidu-progress").inner_text()
                print(f"PASS: {row_count} rows, viewport translation, toggle, and cache restore")
            finally:
                context.close()
finally:
    server.shutdown()
    server.server_close()
