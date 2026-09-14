(() => {
  const ROOT_ID = "yidu-article-reader";
  const BATCH_SIZE = 6;
  let previousOverflow = "";

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== "YIDU_START") return;
    const existing = document.getElementById(ROOT_ID);
    if (existing) {
      closeReader();
      return;
    }
    startReader();
  });

  async function startReader() {
    const article = extractArticle();
    if (!article.segments.length) {
      showInlineNotice("没有识别到可翻译的英文文章正文。");
      return;
    }

    previousOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    const root = document.createElement("div");
    root.id = ROOT_ID;
    root.innerHTML = createReaderMarkup(article);
    document.documentElement.append(root);
    root.querySelector(".yidu-close").addEventListener("click", closeReader);
    document.addEventListener("keydown", handleEscape);

    await translateArticle(root, article);
  }

  function extractArticle() {
    const candidates = [...document.querySelectorAll("article, main, [role='main']")];
    const container = candidates
      .map((element) => ({ element, score: readableText(element).length }))
      .sort((a, b) => b.score - a.score)[0]?.element || document.body;
    const selectors = "h1, h2, h3, p, blockquote, li";
    const nodes = [...container.querySelectorAll(selectors)];
    const segments = [];
    let totalCharacters = 0;

    for (const node of nodes) {
      if (node.closest(`#${ROOT_ID}, nav, footer, aside, form`) || node.querySelector(selectors)) continue;
      const text = readableText(node);
      const isHeading = /^H[1-3]$/.test(node.tagName);
      if ((!isHeading && text.length < 35) || text.length > 1800) continue;
      if (totalCharacters + text.length > 30000 || segments.length >= 64) break;
      segments.push({ id: String(segments.length + 1), text, kind: isHeading ? "heading" : "body" });
      totalCharacters += text.length;
    }

    const title = document.querySelector("h1")?.textContent?.trim() || document.title || "Untitled article";
    return { title, source: location.hostname, segments };
  }

  function readableText(element) {
    return (element.innerText || element.textContent || "").replace(/\s+/g, " ").trim();
  }

  function createReaderMarkup(article) {
    const rows = article.segments.map((segment) => `
      <section class="yidu-pair ${segment.kind === "heading" ? "yidu-heading-pair" : ""}" data-segment-id="${segment.id}">
        <div class="yidu-source" lang="en"></div>
        <div class="yidu-translation yidu-pending" lang="zh-CN"><span class="yidu-skeleton"></span></div>
      </section>`).join("");

    return `
      <div class="yidu-reader" role="dialog" aria-modal="true" aria-label="英文文章双语翻译">
        <header class="yidu-toolbar">
          <div class="yidu-brand"><span class="yidu-mark">译</span><span>译读</span></div>
          <nav class="yidu-tabs" aria-label="阅读功能"><span class="yidu-tab" aria-current="page">双语对照</span></nav>
          <div class="yidu-progress" role="status" aria-live="polite">正在准备翻译…</div>
          <button class="yidu-close" type="button" aria-label="关闭双语阅读">×</button>
        </header>
        <main class="yidu-book">
          <div class="yidu-title-spread">
            <div><p class="yidu-kicker">${escapeHtml(article.source)}</p><h1>${escapeHtml(article.title)}</h1></div>
            <div><p class="yidu-kicker">AI TRANSLATION</p><h2 class="yidu-title-target">正在翻译标题…</h2></div>
          </div>
          <div class="yidu-labels" aria-hidden="true"><span>ORIGINAL · ENGLISH</span><span>TRANSLATION · 简体中文</span></div>
          <div class="yidu-pairs">${rows}</div>
        </main>
        <footer class="yidu-status"><span class="yidu-status-dot"></span><span>API Key 与翻译内容仅发送至你配置的 DeepSeek 服务</span></footer>
      </div>`;
  }

  async function translateArticle(root, article) {
    const rows = new Map([...root.querySelectorAll(".yidu-pair")].map((row) => [row.dataset.segmentId, row]));
    for (const segment of article.segments) {
      const source = rows.get(segment.id)?.querySelector(".yidu-source");
      if (source) source.textContent = segment.text;
    }

    const glossary = {};
    let translatedCount = 0;
    try {
      for (let offset = 0; offset < article.segments.length; offset += BATCH_SIZE) {
        const segments = article.segments.slice(offset, offset + BATCH_SIZE);
        setProgress(root, `正在翻译 ${translatedCount + 1}–${Math.min(offset + BATCH_SIZE, article.segments.length)} / ${article.segments.length} 段`);
        const result = await chrome.runtime.sendMessage({
          type: "YIDU_TRANSLATE_BATCH",
          payload: { title: article.title, segments, glossary }
        });
        if (!result?.ok) throw Object.assign(new Error(result?.message || "翻译失败"), { code: result?.code });

        for (const item of result.items) {
          for (const term of item.terms) glossary[term.source] = term.target;
          renderTranslation(rows.get(item.id), item);
          translatedCount += 1;
        }
      }

      const firstTranslation = rows.get("1")?.querySelector(".yidu-translation")?.textContent?.trim();
      if (article.segments[0]?.kind === "heading" && firstTranslation) {
        root.querySelector(".yidu-title-target").textContent = firstTranslation;
        rows.get("1")?.remove();
      } else {
        root.querySelector(".yidu-title-target").textContent = "中文译文";
      }
      setProgress(root, `${translatedCount} 段已完成 · ${Object.keys(glossary).length} 个术语`);
    } catch (error) {
      showReaderError(root, error.message, error.code === "SETUP_REQUIRED");
    }
  }

  function renderTranslation(row, item) {
    if (!row) return;
    const source = row.querySelector(".yidu-source");
    const target = row.querySelector(".yidu-translation");
    appendHighlightedText(source, source.textContent, item.terms, "source");
    appendHighlightedText(target, item.translation, item.terms, "target");
    target.classList.remove("yidu-pending");
  }

  function appendHighlightedText(container, text, terms, key) {
    container.replaceChildren();
    const matches = [];
    for (const term of terms || []) {
      const needle = String(term?.[key] || "").trim();
      if (!needle) continue;
      const lowerText = text.toLocaleLowerCase();
      const lowerNeedle = needle.toLocaleLowerCase();
      let from = 0;
      while (from < text.length) {
        const index = lowerText.indexOf(lowerNeedle, from);
        if (index < 0) break;
        matches.push({ start: index, end: index + needle.length });
        from = index + needle.length;
      }
    }
    matches.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start));
    const accepted = [];
    for (const match of matches) {
      if (!accepted.some((item) => match.start < item.end && match.end > item.start)) accepted.push(match);
    }
    accepted.sort((a, b) => a.start - b.start);
    let cursor = 0;
    for (const match of accepted) {
      container.append(document.createTextNode(text.slice(cursor, match.start)));
      const mark = document.createElement("mark");
      mark.className = "yidu-term";
      mark.textContent = text.slice(match.start, match.end);
      container.append(mark);
      cursor = match.end;
    }
    container.append(document.createTextNode(text.slice(cursor)));
  }

  function showReaderError(root, message, setupRequired) {
    const progress = root.querySelector(".yidu-progress");
    progress.textContent = "翻译未完成";
    const error = document.createElement("div");
    error.className = "yidu-error";
    error.innerHTML = `<strong>${escapeHtml(message)}</strong><span>${setupRequired ? "填写密钥后，再次点击扩展图标。" : "请检查网络或模型设置后重试。"}</span>`;
    if (setupRequired) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "打开设置";
      button.addEventListener("click", () => chrome.runtime.sendMessage({ type: "YIDU_OPEN_OPTIONS" }));
      error.append(button);
    }
    root.querySelector(".yidu-book").prepend(error);
  }

  function setProgress(root, text) {
    root.querySelector(".yidu-progress").textContent = text;
  }

  function showInlineNotice(message) {
    const notice = document.createElement("div");
    notice.className = "yidu-inline-notice";
    notice.textContent = message;
    document.documentElement.append(notice);
    window.setTimeout(() => notice.remove(), 4000);
  }

  function handleEscape(event) {
    if (event.key === "Escape") closeReader();
  }

  function closeReader() {
    document.getElementById(ROOT_ID)?.remove();
    document.documentElement.style.overflow = previousOverflow;
    document.removeEventListener("keydown", handleEscape);
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character]);
  }
})();
