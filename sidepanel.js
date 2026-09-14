(() => {
  const BATCH_SIZE = 4;
  const VIEWPORT_MARGIN = "520px 0px";
  const content = document.getElementById("content");
  const status = document.getElementById("status");
  const toggle = document.getElementById("term-toggle");
  let session = null;
  let reloadTimer = 0;

  document.getElementById("settings").addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "YIDU_OPEN_OPTIONS" });
  });
  toggle.addEventListener("click", () => {
    const enabled = toggle.getAttribute("aria-checked") !== "true";
    toggle.setAttribute("aria-checked", String(enabled));
    if (session) {
      session.termsVisible = enabled;
      for (const [id, item] of session.translations) renderTranslation(session, id, item);
    }
  });
  chrome.tabs.onActivated.addListener(scheduleReload);
  chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
    if (changeInfo.status === "complete" && tab.active) scheduleReload();
  });
  chrome.runtime.onMessage.addListener((message, sender) => {
    if (message?.type === "YIDU_SOURCE_SCROLL") handleSourceScroll(message.payload, sender.tab?.id);
    return false;
  });

  void loadActiveArticle();

  function scheduleReload() {
    window.clearTimeout(reloadTimer);
    reloadTimer = window.setTimeout(() => void loadActiveArticle(), 120);
  }

  function handleSourceScroll(payload, tabId) {
    const current = session;
    if (!current || current.stopped || tabId !== current.tabId) return;
    const row = current.rows.get(String(payload?.segmentId || ""));
    if (!row) return;
    const index = current.article.segments.findIndex((segment) => segment.id === row.dataset.segmentId);
    current.article.segments.slice(index, index + BATCH_SIZE).forEach((segment) => enqueue(current, segment));
    requestAnimationFrame(() => {
      if (current.stopped) return;
      const rect = row.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, Number(payload?.ratio || 0)));
      const target = window.scrollY + rect.top + rect.height * ratio - window.innerHeight * 0.35;
      const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      window.scrollTo(0, Math.max(0, Math.min(maxScroll, target)));
    });
  }
  async function loadActiveArticle() {
    stopSession();
    setStatus("正在读取文章…");
    content.setAttribute("aria-busy", "true");
    content.replaceChildren();
    try {
      const tab = await findArticleTab();
      if (!tab?.id) throw new Error("请先打开一篇英文网页文章。");
      const response = await getArticleFromTab(tab.id);
      if (!response?.ok || !response.article?.segments?.length) {
        throw new Error(response?.message || "没有识别到可翻译的英文文章正文。");
      }
      startSession(response.article, tab.id);
    } catch (error) {
      showEmpty(error?.message || "无法读取当前页面。", true);
    }
  }

  async function findArticleTab() {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    return tabs
      .filter((tab) => /^https?:/i.test(tab.url || ""))
      .sort((left, right) => Number(right.active) - Number(left.active) || Number(right.lastAccessed || 0) - Number(left.lastAccessed || 0))[0];
  }

  async function getArticleFromTab(tabId) {
    await waitForTabReady(tabId);
    let lastMessage = "无法读取当前页面，请刷新页面后重试。";
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await chrome.tabs.sendMessage(tabId, { type: "YIDU_GET_ARTICLE" });
      } catch (error) {
        lastMessage = error?.message || lastMessage;
        if (attempt === 0) {
          const prepared = await chrome.runtime.sendMessage({ type: "YIDU_PREPARE_TAB", payload: { tabId } });
          if (!prepared?.ok) lastMessage = prepared?.message || lastMessage;
        }
        await delay(180);
      }
    }
    return { ok: false, message: lastMessage };
  }

  async function waitForTabReady(tabId) {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const tab = await chrome.tabs.get(tabId);
      if (tab.status === "complete") return;
      await delay(150);
    }
  }

  function delay(milliseconds) {
    return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  }

  function startSession(article, tabId) {
    const next = {
      article,
      tabId,
      rows: new Map(),
      segmentsById: new Map(article.segments.map((segment) => [segment.id, segment])),
      translations: new Map(),
      completed: new Set(),
      queued: new Set(),
      queue: [],
      glossary: {},
      observer: null,
      working: false,
      stopped: false,
      failed: false,
      failedSegments: [],
      cachedCount: 0,
      termsVisible: false
    };
    session = next;
    renderArticle(next);
    void restoreCache(next).then(() => {
      if (next.stopped) return;
      startViewportTranslation(next);
      void chrome.tabs.sendMessage(next.tabId, { type: "YIDU_REQUEST_SCROLL_SYNC" }).catch(() => undefined);
    });
  }

  function renderArticle(current) {
    content.replaceChildren();
    const source = document.createElement("p");
    source.className = "yidu-source";
    source.textContent = current.article.source;
    content.append(source);
    let list = null;
    let listKind = "";
    for (const segment of current.article.segments) {
      const isListItem = segment.kind === "ul-item" || segment.kind === "ol-item";
      let element;
      if (isListItem) {
        if (!list || listKind !== segment.kind) {
          list = document.createElement(segment.kind === "ol-item" ? "ol" : "ul");
          list.className = "yidu-list";
          content.append(list);
          listKind = segment.kind;
        }
        element = document.createElement("li");
        list.append(element);
      } else {
        list = null;
        listKind = "";
        const tag = /^h[1-6]$/.test(segment.kind) ? segment.kind : segment.kind === "blockquote" ? "blockquote" : "p";
        element = document.createElement(tag);
        content.append(element);
      }
      element.className = `yidu-segment yidu-${segment.kind} yidu-pending`;
      element.dataset.segmentId = segment.id;
      element.setAttribute("aria-busy", "true");
      current.rows.set(segment.id, element);
    }
    content.setAttribute("aria-busy", "false");
  }

  async function restoreCache(current) {
    try {
      const result = await chrome.runtime.sendMessage({
        type: "YIDU_CACHE_GET",
        payload: { url: current.article.url, segments: current.article.segments }
      });
      if (!result?.ok || current.stopped) return;
      for (const item of result.items || []) applyTranslation(current, item, true);
    } catch {
      // 缓存不可用时继续翻译。
    }
  }

  function startViewportTranslation(current) {
    current.article.segments.slice(0, BATCH_SIZE).forEach((segment) => enqueue(current, segment));
    if (!("IntersectionObserver" in window)) {
      current.article.segments.forEach((segment) => enqueue(current, segment));
      return;
    }
    current.observer = new IntersectionObserver((entries) => {
      entries.filter((entry) => entry.isIntersecting).forEach((entry) => {
        const segment = current.segmentsById.get(entry.target.dataset.segmentId);
        if (segment) enqueue(current, segment);
        current.observer?.unobserve(entry.target);
      });
    }, { rootMargin: VIEWPORT_MARGIN, threshold: 0 });
    for (const row of current.rows.values()) {
      if (!current.completed.has(row.dataset.segmentId)) current.observer.observe(row);
    }
    updateProgress(current);
  }

  function enqueue(current, segment) {
    if (current.stopped || current.failed || current.completed.has(segment.id) || current.queued.has(segment.id)) return;
    current.queue.push(segment);
    current.queued.add(segment.id);
    queueMicrotask(() => void processQueue(current));
  }

  async function processQueue(current) {
    if (current.working || current.stopped || current.failed) return;
    current.working = true;
    try {
      while (current.queue.length && !current.stopped && !current.failed) {
        const segments = current.queue.splice(0, BATCH_SIZE);
        segments.forEach((segment) => current.queued.delete(segment.id));
        current.failedSegments = segments;
        updateProgress(current, segments.length);
        const result = await chrome.runtime.sendMessage({
          type: "YIDU_TRANSLATE_BATCH",
          payload: { title: current.article.title, segments, glossary: current.glossary }
        });
        if (!result?.ok) throw Object.assign(new Error(result?.message || "翻译失败"), { code: result?.code });
        if (current.stopped) return;
        for (const item of result.items) applyTranslation(current, item, false);
        void chrome.runtime.sendMessage({
          type: "YIDU_CACHE_PUT",
          payload: { url: current.article.url, segments, items: result.items }
        }).catch(() => undefined);
        current.failedSegments = [];
      }
    } catch (error) {
      current.failed = true;
      showError(current, error?.message || "翻译失败，请稍后重试。", error?.code === "SETUP_REQUIRED");
    } finally {
      current.working = false;
      updateProgress(current);
    }
  }

  function applyTranslation(current, item, fromCache) {
    if (current.completed.has(item.id)) return;
    const segment = current.segmentsById.get(item.id);
    if (!segment) return;
    current.translations.set(item.id, item);
    for (const term of item.terms || []) current.glossary[term.source] = term.target;
    current.completed.add(item.id);
    if (fromCache) current.cachedCount += 1;
    current.observer?.unobserve(current.rows.get(item.id));
    renderTranslation(current, item.id, item);
    updateProgress(current);
  }

  function renderTranslation(current, id, item) {
    const row = current.rows.get(id);
    const segment = current.segmentsById.get(id);
    if (!row || !segment) return;
    row.replaceChildren(buildSafeFragment(item.translation, segment, current.termsVisible ? item.terms : []));
    row.classList.remove("yidu-pending");
    row.removeAttribute("aria-busy");
    row.dataset.translated = "true";
  }

  function buildSafeFragment(markup, segment, terms) {
    const template = document.createElement("template");
    template.innerHTML = String(markup || "");
    const fragment = document.createDocumentFragment();
    for (const node of template.content.childNodes) {
      const safe = sanitizeNode(node, segment, terms);
      if (safe) fragment.append(safe);
    }
    return fragment;
  }

  function sanitizeNode(node, segment, terms) {
    if (node.nodeType === Node.TEXT_NODE) return highlightedText(node.nodeValue || "", terms);
    if (node.nodeType !== Node.ELEMENT_NODE) return null;
    const tag = node.tagName.toLowerCase();
    if (tag === "script" || tag === "style") return null;
    if (tag === "br") return document.createElement("br");
    let element;
    if (tag === "strong" || tag === "b") element = document.createElement("strong");
    else if (tag === "u") element = document.createElement("u");
    else if (tag === "em" || tag === "i") {
      element = document.createElement("span");
      element.className = "yidu-emphasis";
    } else if (tag === "code") element = document.createElement("code");
    else if (tag === "a") {
      const linkIndex = node.getAttribute("data-link");
      const href = /^\d+$/.test(linkIndex || "") ? segment.links?.[Number(linkIndex)] : "";
      if (!href) return copyChildren(node, document.createDocumentFragment(), segment, terms);
      element = document.createElement("a");
      element.href = href;
      element.target = "_blank";
      element.rel = "noopener noreferrer";
    } else return copyChildren(node, document.createDocumentFragment(), segment, terms);
    return copyChildren(node, element, segment, terms);
  }

  function copyChildren(source, target, segment, terms) {
    for (const child of source.childNodes) {
      const safe = sanitizeNode(child, segment, terms);
      if (safe) target.append(safe);
    }
    return target;
  }

  function highlightedText(text, terms) {
    const fragment = document.createDocumentFragment();
    const matches = [];
    for (const term of terms || []) {
      const needle = String(term?.target || "").trim();
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
      fragment.append(document.createTextNode(text.slice(cursor, match.start)));
      const mark = document.createElement("mark");
      mark.className = "yidu-term";
      mark.textContent = text.slice(match.start, match.end);
      fragment.append(mark);
      cursor = match.end;
    }
    fragment.append(document.createTextNode(text.slice(cursor)));
    return fragment;
  }

  function showError(current, message, setupRequired) {
    setStatus("");
    document.querySelector(".yidu-error")?.remove();
    const box = document.createElement("section");
    box.className = "yidu-error";
    const title = document.createElement("strong");
    title.textContent = message;
    const detail = document.createElement("span");
    detail.textContent = setupRequired ? "填写密钥后即可继续。" : "已完成的翻译会保留。";
    const actions = document.createElement("div");
    actions.className = "yidu-actions";
    const button = document.createElement("button");
    button.className = "yidu-action";
    button.type = "button";
    button.textContent = setupRequired ? "打开设置" : "重试";
    button.addEventListener("click", () => {
      if (setupRequired) {
        chrome.runtime.sendMessage({ type: "YIDU_OPEN_OPTIONS" });
        return;
      }
      box.remove();
      current.failed = false;
      current.failedSegments.splice(0).forEach((segment) => enqueue(current, segment));
    });
    actions.append(button);
    box.append(title, detail, actions);
    content.prepend(box);
  }

  function showEmpty(message, retryable) {
    content.setAttribute("aria-busy", "false");
    setStatus("");
    const box = document.createElement("section");
    box.className = "yidu-empty";
    const title = document.createElement("strong");
    title.textContent = message;
    box.append(title);
    if (retryable) {
      const actions = document.createElement("div");
      actions.className = "yidu-actions";
      const retry = document.createElement("button");
      retry.className = "yidu-action secondary";
      retry.type = "button";
      retry.textContent = "重新读取";
      retry.addEventListener("click", () => void loadActiveArticle());
      actions.append(retry);
      box.append(actions);
    }
    content.replaceChildren(box);
  }

  function updateProgress(current, activeBatchSize = 0) {
    if (current.stopped || current.failed) return;
    const done = current.completed.size;
    const total = current.article.segments.length;
    if (done === total) setStatus("");
    else if (activeBatchSize || current.working) setStatus(`正在翻译 · ${done} / ${total}`);
    else setStatus(`${done} / ${total} · 向下阅读继续翻译${current.cachedCount ? ` · 缓存 ${current.cachedCount}` : ""}`);
  }

  function setStatus(message) {
    status.textContent = message;
  }

  function stopSession() {
    if (!session) return;
    session.stopped = true;
    session.observer?.disconnect();
    session = null;
  }
})();
