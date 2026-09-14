import os
import tempfile
import time

from playwright.sync_api import sync_playwright


PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
TEST_URL = os.environ.get("YIDU_TEST_URL", "http://127.0.0.1:8766/index.html")


with sync_playwright() as playwright:
    with tempfile.TemporaryDirectory(prefix="yidu-e2e-", ignore_cleanup_errors=True) as profile:
        context = playwright.chromium.launch_persistent_context(
            profile,
            channel="chromium",
            headless=True,
            args=[
                f"--disable-extensions-except={PROJECT_ROOT}",
                f"--load-extension={PROJECT_ROOT}",
            ],
        )
        try:
            page = context.pages[0] if context.pages else context.new_page()
            page.goto(TEST_URL, wait_until="domcontentloaded")

            deadline = time.monotonic() + 10
            worker = next((item for item in context.service_workers if item.url.endswith("/background.js")), None)
            while worker is None and time.monotonic() < deadline:
                candidate = context.wait_for_event("serviceworker", timeout=2_000)
                if candidate.url.endswith("/background.js"):
                    worker = candidate
            assert worker is not None, "译读后台进程未启动"
            worker.evaluate(
                """async (url) => {
                  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                  if (!tab?.id) throw new Error("Test tab was not found");
                  try {
                    await chrome.tabs.sendMessage(tab.id, { type: "YIDU_START" });
                  } catch {
                    await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ["content.css"] });
                    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
                    await chrome.tabs.sendMessage(tab.id, { type: "YIDU_START" });
                  }
                }""",
                TEST_URL,
            )

            reader = page.locator("#yidu-article-reader")
            reader.wait_for(state="visible", timeout=10_000)
            assert reader.get_by_text("双语对照", exact=True).count() == 1
            assert reader.get_by_text("仅中文", exact=True).count() == 0
            assert reader.get_by_text("重新翻译", exact=True).count() == 0
            toggle = reader.get_by_role("switch", name="专有名词高亮")
            assert toggle.get_attribute("aria-checked") == "false"
            assert reader.locator(".yidu-reader").get_attribute("data-terms-visible") == "false"
            toggle.click()
            assert toggle.get_attribute("aria-checked") == "true"
            assert reader.locator(".yidu-reader").get_attribute("data-terms-visible") == "true"
            toggle.click()
            assert toggle.get_attribute("aria-checked") == "false"
            assert reader.locator(".yidu-reader").get_attribute("data-terms-visible") == "false"
            assert page.locator(".yidu-pair").count() > 0
            print("PASS: extension reader opened and extracted article segments")
        finally:
            context.close()