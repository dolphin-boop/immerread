import functools
import os
import re
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
                article_page = context.pages[0] if context.pages else context.new_page()
                article_page.goto(test_url, wait_until="domcontentloaded")

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
                        const items = input.segments.map((segment) => {
                          const markup = String(segment.markup || segment.text)
                            .replaceAll("AI agent", "AI 智能体")
                            .replaceAll("Evaluation", "评测")
                            .replaceAll("evaluation", "评测");
                          return {
                            id: segment.id,
                            translation: `译文：${markup}`,
                            terms: String(segment.text).includes("AI agent")
                              ? [{ source: "AI agent", target: "AI 智能体" }]
                              : []
                          };
                        });
                        return new Response(JSON.stringify({
                          choices: [{ message: { content: JSON.stringify({ items }) } }]
                        }), { status: 200, headers: { "Content-Type": "application/json" } });
                      };
                    }"""
                )

                extension_match = re.match(r"(chrome-extension://[^/]+)", worker.url)
                assert extension_match, "无法确定扩展地址"
                panel = context.new_page()
                panel.set_viewport_size({"width": 420, "height": 720})
                panel.goto(f"{extension_match.group(1)}/sidepanel.html", wait_until="domcontentloaded")

                panel.locator(".yidu-segment").first.wait_for(state="visible", timeout=10_000)
                row_count = panel.locator(".yidu-segment").count()
                assert row_count == 96 if is_fixture else row_count > 64
                panel.wait_for_function(
                    "document.querySelectorAll('.yidu-segment[data-translated=\"true\"]').length >= 4"
                )
                initial_translated = panel.locator('.yidu-segment[data-translated="true"]').count()
                assert initial_translated < row_count, "首屏不应立即翻译整篇文章"
                assert panel.locator("h1.yidu-h1").get_attribute("data-translated") == "true"

                toggle = panel.get_by_role("switch", name="AI 术语高亮")
                assert toggle.get_attribute("aria-checked") == "false"

                if is_fixture:
                    rich = panel.locator('[data-segment-id="s3"]')
                    rich.locator("strong").wait_for(state="visible")
                    assert rich.locator("u").count() == 1
                    assert rich.locator("a").get_attribute("href") == "https://example.com/reference"
                    assert rich.locator("code").inner_text() == "model_id"
                    assert panel.locator("blockquote.yidu-blockquote").count() == 1
                    assert panel.locator("ul.yidu-list li").count() == 2
                    toggle.click()
                    assert toggle.get_attribute("aria-checked") == "true"
                    assert rich.locator("mark.yidu-term").count() == 1
                    toggle.click()
                    assert toggle.get_attribute("aria-checked") == "false"

                screenshot_path = os.environ.get("YIDU_SCREENSHOT_PATH")
                if screenshot_path:
                    panel.screenshot(path=screenshot_path, full_page=False)

                initial_panel_scroll = panel.evaluate("window.scrollY")
                article_scroll = article_page.evaluate("""() => {
                  document.documentElement.style.scrollBehavior = "auto";
                  window.scrollTo(0, document.documentElement.scrollHeight);
                  return window.scrollY;
                }""")
                assert article_scroll > 0
                sync_deadline = time.monotonic() + 10
                while panel.evaluate("window.scrollY") <= initial_panel_scroll + 100 and time.monotonic() < sync_deadline:
                    time.sleep(0.05)
                assert panel.evaluate("window.scrollY") > initial_panel_scroll + 100, "原文滚动没有带动右侧译文"
                last_segment = panel.locator(".yidu-segment").last
                while last_segment.get_attribute("data-translated") != "true" and time.monotonic() < sync_deadline:
                    time.sleep(0.05)
                assert last_segment.get_attribute("data-translated") == "true"
                time.sleep(0.3)
                calls_before_reload = worker.evaluate("globalThis.__yiduFetchCalls")
                assert calls_before_reload >= 2

                panel.reload(wait_until="domcontentloaded")
                panel.locator(".yidu-segment").first.wait_for(state="visible", timeout=10_000)
                panel.wait_for_function(
                    f"document.querySelectorAll('.yidu-segment[data-translated=\"true\"]').length >= {initial_translated}"
                )
                time.sleep(0.5)
                assert worker.evaluate("globalThis.__yiduFetchCalls") == calls_before_reload
                assert panel.locator("#yidu-article-reader").count() == 0
                assert article_page.locator("#yidu-article-reader").count() == 0
                print(f"PASS: {row_count} semantic blocks, source-scroll sync, formatting, and cache restore")
            finally:
                context.close()
finally:
    server.shutdown()
    server.server_close()
