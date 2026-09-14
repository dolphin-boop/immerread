(() => {
  const ROOT_ID = "yidu-article-reader";
  const BATCH_SIZE = 4;
  const MAX_SEGMENT_CHARS = 1200;
  const VIEWPORT_MARGIN = "520px 0px";
  let previousOverflow = "";
  let activeSession = null;

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== "YIDU_START") return;
    const existing = document.getElementById(ROOT_ID);
    if (existing) {
      closeReader();
      return;
    }
    void startReader();
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
    root.querySelector(".yidu-term-toggle").addEventListener("click", toggleTermHighlights);
    document.addEventListener("keydown", handleEscape);

    const rows = new Map([...root.querySelectorAll(".yidu-pair")].map((row) => [row.dataset.segmentId, row]));
    for (const segment of article.segments) {
      const source = rows.get(segment.id)?.querySelector(".yidu-source");
      if (source) source.textContent = segment.text;
    }

    const session = {
      root,
      article,
      rows,
      segmentsById: new Map(article.segments.map((segment) => [segment.id, segment])),
      completed: new Set(),
      queued: new Set(),
      queue: [],
      glossary: {},
      observer: null,
      working: false,
      stopped: false,
      failed: false,
      failedSegments: [],
      cachedCount: 0
    };
    activeSession = session;
    await restoreCachedTranslations(session);
    if (session.stopped) return;
    startViewportTranslation(session);
  }

  function extractArticle() {
    const candidates = [...document.querySelectorAll("article, main, [role='main']")];
    const container = candidates
      .map((element) => ({ element, score: readableText(element).length }))
      .sort((a, b) => b.score - a.score)[0]?.element || document.body;
    const selectors = "h1, h2, h3, p, blockquote, li";
    const nodes = [...container.querySelectorAll(selectors)];
    const title = document.querySelector("h1")?.textContent?.trim() || document.title || "Untitled article";
    const segments = [{ id: "title", text: title, kind: "title" }];

    for (const node of nodes) {
      if (node.closest(`#${ROOT_ID}, nav, footer, aside, form`) || node.querySelector(selectors)) continue;
      const text = readableText(node);
      if (text.length < 2) continue;
      const isHeading = /^H[1-3]$/.test(node.tagName);
      if (isHeading && text === title) continue;
      const parts = isHeading ? [text] : splitOversizedText(text);
      for (const part of parts) {
        segments.push({ id: `s${segments.length}`, text: part, kind: isHeading ? "heading" : "body" });
      }
    }

    const canonicalUrl = document.querySelector('link[rel="canonical"]')?.href || location.href;
    return { title, source: location.hostname, url: canonicalUrl, segments };
  }

  function splitOversizedText(text, limit = MAX_SEGMENT_CHARS) {
    if (text.length <= limit) return [text];
    const sentences = text.match(/[^.!?。！？]+(?:[.!?。！？]+["')\]]*|$)/g) || [text];
    const chunks = [];
    let current = "";
    for (const sentence of sentences) {
      for (const piece of splitPiece(sentence.trim(), limit)) {
        if (!piece) continue;
        const combined = current ? `${current} ${piece}` : piece;
        if (combined.length <= limit) {
          current = combined;
        } else {
          if (current) chunks.push(current);
          current = piece;
        }
      }
    }
    if (current) chunks.push(current);
    return chunks;
  }

  function splitPiece(text, limit) {
    const pieces = [];
    let rest = text;
    while (rest.length > limit) {
      let splitAt = rest.lastIndexOf(" ", limit);
      if (splitAt < Math.floor(limit * 0.6)) splitAt = limit;
      pieces.push(rest.slice(0, splitAt).trim());
      rest = rest.slice(splitAt).trim();
    }
    if (rest) pieces.push(rest);
    return pieces;
  }

  function readableText(element) {
    return (element.innerText || element.textContent || "").replace(/\s+/g, " ").trim();
  }

  function createReaderMarkup(article) {
    const rows = article.segments.filter((segment) => segment.kind !== "title").map((segment) => `
      <section class="yidu-pair ${segment.kind === "heading" ? "yidu-heading-pair" : ""}" data-segment-id="${segment.id}">
        <div class="yidu-source" lang="en"></div>
        <div class="yidu-translation yidu-pending" lang="zh-CN"><span class="yidu-skeleton"></span></div>
      </section>`).join("");

    return `
      <div class="yidu-reader" data-terms-visible="false" role="dialog" aria-modal="true" aria-label="英文文章双语翻译">
        <header class="yidu-toolbar">
          <div class="yidu-brand"><span class="yidu-mark">译</span><span>译读</span></div>
          <nav class="yidu-tabs" aria-label="阅读功能"><span class="yidu-tab" aria-current="page">双语对照</span><button class="yidu-term-toggle" type="button" role="switch" aria-checked="false"><span>专有名词高亮</span><i aria-hidden="true"></i></button></nav>
          <div class="yidu-progress" role="status" aria-live="polite">正在读取本地缓存…</div>
          <button class="yidu-close" type="button" aria-label="关闭双语阅读">×</button>
        </header>
        <main class="yidu-book">
          <div class="yidu-title-spread">
            <div><p class="yidu-kicker">${escapeHtml(article.source)}</p><h1 class="yidu-title-source">${escapeHtml(article.title)}</h1></div>
            <div><p class="yidu-kicker">AI TRANSLATION</p><h2 class="yidu-title-target">正在翻译标题…</h2></div>
          </div>
          <div class="yidu-labels" aria-hidden="true"><span>ORIGINAL · ENGLISH</span><span>TRANSLATION · 简体中文</span></div>
          <div class="yidu-pairs">${rows}</div>
        </main>
        <footer class="yidu-status"><span class="yidu-status-dot"></span><span>翻译结果缓存在当前浏览器中；阅读到附近时才调用 DeepSeek</span></footer>
      </div>`;
  }

  async function restoreCachedTranslations(session) {
    try {
      const result = await chrome.runtime.sendMessage({
        type: "YIDU_CACHE_GET",
        payload: { url: session.article.url, segments: session.article.segments }
      });
      if (!result?.ok || session.stopped) return;
      for (const item of result.items || []) {
        applyTranslation(session, item, true);
      }
    } catch {
      // 缓存不可用时继续正常翻译。
    }
  }

  function startViewportTranslation(session) {
    session.article.segments.slice(0, BATCH_SIZE).forEach((segment) => enqueueSegment(session, segment));
    if (!("IntersectionObserver" in window)) {
      session.article.segments.forEach((segment) => enqueueSegment(session, segment));
      return;
    }
    session.observer = new IntersectionObserver((entries) => {
      entries
        .filter((entry) => entry.isIntersecting)
        .sort((left, right) => Number(left.target.dataset.order) - Number(right.target.dataset.order))
        .forEach((entry) => {
          const segment = session.segmentsById.get(entry.target.dataset.segmentId);
          if (segment) enqueueSegment(session, segment);
          session.observer?.unobserve(entry.target);
        });
    }, { root: session.root, rootMargin: VIEWPORT_MARGIN, threshold: 0 });
    [...session.rows.values()].forEach((row, index) => {
      row.dataset.order = String(index);
      if (!session.completed.has(row.dataset.segmentId)) session.observer.observe(row);
    });
    updateProgress(session);
  }

  function enqueueSegment(session, segment) {
    if (session.stopped || session.failed || session.completed.has(segment.id) || session.queued.has(segment.id)) return;
    session.queue.push(segment);
    session.queued.add(segment.id);
    queueMicrotask(() => void processTranslationQueue(session));
  }

  async function processTranslationQueue(session) {
    if (session.working || session.stopped || session.failed) return;
    session.working = true;
    try {
      while (session.queue.length && !session.stopped && !session.failed) {
        const segments = session.queue.splice(0, BATCH_SIZE);
        segments.forEach((segment) => session.queued.delete(segment.id));
        session.failedSegments = segments;
        updateProgress(session, segments.length);
        const result = await chrome.runtime.sendMessage({
          type: "YIDU_TRANSLATE_BATCH",
          payload: { title: session.article.title, segments, glossary: session.glossary }
        });
        if (!result?.ok) throw Object.assign(new Error(result?.message || "翻译失败"), { code: result?.code });
        if (session.stopped) return;
        for (const item of result.items) applyTranslation(session, item, false);
        void chrome.runtime.sendMessage({
          type: "YIDU_CACHE_PUT",
          payload: { url: session.article.url, segments, items: result.items }
        }).catch(() => undefined);
        session.failedSegments = [];
      }
    } catch (error) {
      session.failed = true;
      showReaderError(session, error.message, error.code === "SETUP_REQUIRED");
    } finally {
      session.working = false;
      updateProgress(session);
    }
  }

  function applyTranslation(session, item, fromCache) {
    if (session.completed.has(item.id)) return;
    for (const term of item.terms || []) session.glossary[term.source] = term.target;
    const segment = session.segmentsById.get(item.id);
    if (!segment) return;
    if (segment.kind === "title") {
      appendHighlightedText(session.root.querySelector(".yidu-title-source"), segment.text, item.terms, "source");
      appendHighlightedText(session.root.querySelector(".yidu-title-target"), item.translation, item.terms, "target");
    } else {
      renderTranslation(session.rows.get(item.id), item);
      session.observer?.unobserve(session.rows.get(item.id));
    }
    session.completed.add(item.id);
    if (fromCache) session.cachedCount += 1;
    updateProgress(session);
  }

  function renderTranslation(row, item) {
    if (!row) return;
    const source = row.querySelector(".yidu-source");
    const target = row.querySelector(".yidu-translation");
    appendHighlightedText(source, source.textContent, item.terms, "source");
    appendHighlightedText(target, item.translation, item.terms, "target");
    target.classList.remove("yidu-pending");
    row.dataset.translated = "true";
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
    matches.sort((left, right) => left.start - right.start || right.end - right.start - (left.end - left.start));
    const accepted = [];
    for (const match of matches) {
      if (!accepted.some((item) => match.start < item.end && match.end > item.start)) accepted.push(match);
    }
    accepted.sort((left, right) => left.start - right.start);
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

  function showReaderError(session, message, setupRequired) {
    session.root.querySelector(".yidu-error")?.remove();
    session.root.querySelector(".yidu-progress").textContent = `翻译暂停 · ${session.completed.size} / ${session.article.segments.length}`;
    const error = document.createElement("div");
    error.className = "yidu-error";
    error.innerHTML = `<strong>${escapeHtml(message)}</strong><span>${setupRequired ? "填写密钥后，重新打开阅读器。" : "已翻译内容会保留，可以从失败位置重试。"}</span>`;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = setupRequired ? "打开设置" : "重试";
    button.addEventListener("click", () => {
      if (setupRequired) {
        chrome.runtime.sendMessage({ type: "YIDU_OPEN_OPTIONS" });
        return;
      }
      error.remove();
      session.failed = false;
      const failedSegments = session.failedSegments.splice(0);
      failedSegments.forEach((segment) => enqueueSegment(session, segment));
    });
    error.append(button);
    session.root.querySelector(".yidu-book").prepend(error);
  }

  function updateProgress(session, activeBatchSize = 0) {
    if (session.stopped || session.failed) return;
    const done = session.completed.size;
    const total = session.article.segments.length;
    let text;
    if (done === total) {
      text = `${total} / ${total} 个内容块已完成`;
    } else if (activeBatchSize || session.working) {
      text = `正在翻译视区内容 · ${done} / ${total}`;
    } else {
      text = `${done} / ${total} 已完成 · 向下阅读继续翻译`;
    }
    if (session.cachedCount) text += ` · 缓存 ${session.cachedCount}`;
    session.root.querySelector(".yidu-progress").textContent = text;
  }

  function showInlineNotice(message) {
    const notice = document.createElement("div");
    notice.className = "yidu-inline-notice";
    notice.textContent = message;
    document.documentElement.append(notice);
    window.setTimeout(() => notice.remove(), 4000);
  }

  function toggleTermHighlights(event) {
    const button = event.currentTarget;
    const enabled = button.getAttribute("aria-checked") !== "true";
    button.setAttribute("aria-checked", String(enabled));
    button.closest(".yidu-reader").dataset.termsVisible = String(enabled);
  }

  function handleEscape(event) {
    if (event.key === "Escape") closeReader();
  }

  function closeReader() {
    if (activeSession) {
      activeSession.stopped = true;
      activeSession.observer?.disconnect();
      activeSession = null;
    }
    document.getElementById(ROOT_ID)?.remove();
    document.documentElement.style.overflow = previousOverflow;
    document.removeEventListener("keydown", handleEscape);
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character]);
  }
})();