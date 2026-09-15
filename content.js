(() => {
  if (globalThis.__yiduArticleExtractorInstalled) return;
  globalThis.__yiduArticleExtractorInstalled = true;

  const MAX_SEGMENT_CHARS = 1200;
  const BLOCK_SELECTOR = "h1, h2, h3, h4, h5, h6, p, blockquote, li";
  const EXCLUDED_SELECTOR = "nav, footer, aside, form, script, style, pre, code, figure, [aria-hidden='true']";
  let trackedBlocks = [];
  let trackedIndex = 0;
  let scrollFrame = 0;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "YIDU_REQUEST_SCROLL_SYNC") {
      scheduleScrollSync();
      sendResponse({ ok: true });
      return false;
    }
    if (message?.type !== "YIDU_GET_ARTICLE") return false;
    try {
      sendResponse({ ok: true, article: extractArticle() });
    } catch (error) {
      sendResponse({ ok: false, message: error?.message || "没有识别到可翻译的英文文章正文。" });
    }
    return false;
  });
  window.addEventListener("scroll", scheduleScrollSync, { passive: true });

  function extractArticle() {
    const candidates = [...document.querySelectorAll("article, main, [role='main']")];
    const container = candidates
      .map((element) => ({ element, score: readableText(element).length }))
      .sort((left, right) => right.score - left.score)[0]?.element || document.body;
    const nodes = [...container.querySelectorAll(BLOCK_SELECTOR)];
    const segments = [];
    const nextTrackedBlocks = [];
    const skippedModules = new Set();

    for (const node of nodes) {
      if (node.closest(EXCLUDED_SELECTOR)) continue;
      const module = findComplexModule(node, container);
      if (module) {
        if (!skippedModules.has(module)) {
          skippedModules.add(module);
          const segment = {
            id: "s" + (segments.length + 1),
            kind: "skipped",
            text: "复杂模块保留在原文中；选中文字可单独翻译或解释。",
            markup: "",
            links: []
          };
          segments.push(segment);
          nextTrackedBlocks.push({ id: segment.id, node: module });
        }
        continue;
      }
      const semanticParent = node.parentElement?.closest("blockquote, li");
      if (semanticParent && semanticParent !== node) continue;
      const prepared = prepareBlock(node);
      const text = readableText(prepared);
      if (text.length < 2) continue;
      const kind = getBlockKind(node);
      const serialized = serializeInline(prepared);
      const chunks = text.length > MAX_SEGMENT_CHARS
        ? splitOversizedText(text).map((chunk) => ({ text: chunk, markup: escapeHtml(chunk), links: [] }))
        : [{ text, markup: serialized.markup, links: serialized.links }];
      chunks.forEach((chunk, chunkIndex) => {
        const segment = { id: `s${segments.length + 1}`, kind, ...chunk };
        segments.push(segment);
        if (chunkIndex === 0) nextTrackedBlocks.push({ id: segment.id, node });
      });
    }

    if (!segments.length) throw new Error("没有识别到可翻译的英文文章正文。");
    let titleSegment = segments.find((segment) => segment.kind === "h1");
    if (!titleSegment && document.title.trim()) {
      titleSegment = { id: "title", kind: "h1", text: document.title.trim(), markup: escapeHtml(document.title.trim()), links: [] };
      segments.unshift(titleSegment);
    }
    const title = titleSegment?.text || "Untitled article";
    trackedBlocks = nextTrackedBlocks;
    trackedIndex = 0;
    const canonicalUrl = document.querySelector('link[rel="canonical"]')?.href || location.href;
    return { title, source: location.hostname, url: canonicalUrl, segments };
  }

  function scheduleScrollSync() {
    if (!trackedBlocks.length || scrollFrame) return;
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = 0;
      emitScrollSync();
    });
  }

  function emitScrollSync() {
    if (!trackedBlocks.length) return;
    const anchor = window.innerHeight * 0.35;
    while (trackedIndex + 1 < trackedBlocks.length && trackedBlocks[trackedIndex + 1].node.getBoundingClientRect().top <= anchor) {
      trackedIndex += 1;
    }
    while (trackedIndex > 0 && trackedBlocks[trackedIndex].node.getBoundingClientRect().top > anchor) {
      trackedIndex -= 1;
    }
    const current = trackedBlocks[trackedIndex];
    const rect = current.node.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (anchor - rect.top) / Math.max(rect.height, 1)));
    void chrome.runtime.sendMessage({
      type: "YIDU_SOURCE_SCROLL",
      payload: { segmentId: current.id, ratio }
    }).catch(() => undefined);
  }
  function findComplexModule(node, container) {
    let parent = node.parentElement;
    while (parent && parent !== container && parent !== document.body) {
      if (parent.matches("table, [role='table'], [role='grid']")) return parent;
      const style = getComputedStyle(parent);
      const children = [...parent.children].filter((child) => readableText(child).length > 25);
      if (children.length >= 2 && readableText(parent).length > 100 &&
        (style.display === "grid" || style.display === "flex") &&
        children.some((child, index) => index > 0 &&
          Math.abs(child.getBoundingClientRect().left - children[0].getBoundingClientRect().left) > 40 &&
          Math.abs(child.getBoundingClientRect().top - children[0].getBoundingClientRect().top) < 80)) {
        return parent;
      }
      parent = parent.parentElement;
    }
    return null;
  }

  function prepareBlock(node) {
    const clone = node.cloneNode(true);
    if (node.matches("li")) clone.querySelectorAll("ul, ol").forEach((list) => list.remove());
    return clone;
  }

  function getBlockKind(node) {
    const tag = node.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag)) return tag;
    if (tag === "blockquote") return "blockquote";
    if (tag === "li") return node.parentElement?.tagName === "OL" ? "ol-item" : "ul-item";
    return "paragraph";
  }

  function serializeInline(element) {
    const links = [];
    const serializeNode = (node) => {
      if (node.nodeType === Node.TEXT_NODE) return escapeHtml(node.nodeValue || "");
      if (node.nodeType !== Node.ELEMENT_NODE) return "";
      const tag = node.tagName.toLowerCase();
      if (tag === "br") return "<br>";
      const inner = [...node.childNodes].map(serializeNode).join("");
      if (tag === "strong" || tag === "b") return `<strong>${inner}</strong>`;
      if (tag === "u") return `<u>${inner}</u>`;
      if (tag === "em" || tag === "i") return `<em>${inner}</em>`;
      if (tag === "code") return `<code>${inner}</code>`;
      if (tag === "a") {
        const href = safeHref(node.href);
        if (!href) return inner;
        const index = links.push(href) - 1;
        return `<a data-link="${index}">${inner}</a>`;
      }
      return inner;
    };
    return { markup: [...element.childNodes].map(serializeNode).join(""), links };
  }

  function safeHref(value) {
    try {
      const url = new URL(value, location.href);
      return /^(https?|mailto):$/i.test(url.protocol) ? url.href : "";
    } catch {
      return "";
    }
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
        if (combined.length <= limit) current = combined;
        else {
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


  let selectionRoot = null;
  let selectionShadow = null;
  let selectedText = "";
  let selectedRect = null;
  let requestId = 0;

  document.addEventListener("mouseup", onSelectionChange);
  document.addEventListener("keyup", (event) => {
    if (event.key === "Escape") {
      hideSelectionUi();
      return;
    }
    onSelectionChange();
  });
  document.addEventListener("pointerdown", (event) => {
    if (selectionRoot && event.target !== selectionRoot && !selectionRoot.contains(event.target)) {
      hideSelectionUi();
    }
  }, true);

  function onSelectionChange() {
    if (selectionShadow?.querySelector(".yidu-result")) return;
    const selection = window.getSelection();
    const text = (selection?.toString() || "").replace(/\s+/g, " ").trim();
    if (!text || !/[A-Za-z]/.test(text) || text.length > 800 || !selection?.rangeCount) {
      hideSelectionUi();
      return;
    }
    const anchor = selection.anchorNode?.parentElement;
    if (anchor?.closest("input, textarea, [contenteditable], [role='textbox']")) {
      hideSelectionUi();
      return;
    }
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    if (!rect.width && !rect.height) return;
    selectedText = text;
    selectedRect = rect;
    renderSelectionMenu();
  }

  function ensureSelectionRoot() {
    if (selectionRoot) return;
    selectionRoot = document.createElement("div");
    selectionRoot.id = "yidu-selection-root";
    selectionRoot.style.cssText = "position:fixed;inset:0;z-index:2147483647;pointer-events:none;";
    selectionShadow = selectionRoot.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = [
      ":host{font-family:system-ui,-apple-system,'Microsoft YaHei',sans-serif;color:#222}",
      "button{font:inherit;cursor:pointer}",
      ".yidu-menu,.yidu-result{position:fixed;pointer-events:auto;background:#fffdf9;border:1px solid #e5d7cb;box-shadow:0 12px 34px rgba(28,24,20,.19);border-radius:12px}",
      ".yidu-menu{display:flex;gap:4px;padding:5px}",
      ".yidu-menu button{border:0;background:transparent;border-radius:7px;padding:7px 13px;color:#25201d;font-size:14px}",
      ".yidu-menu button:hover,.yidu-menu button:focus-visible{background:#f4e8df;outline:none}",
      ".yidu-result{width:min(370px,calc(100vw - 24px));max-height:min(440px,calc(100vh - 24px));overflow:auto;padding:16px;box-sizing:border-box}",
      ".yidu-head{display:flex;justify-content:space-between;align-items:center;gap:12px;color:#a45032;font-size:14px;font-weight:700}",
      ".yidu-close{border:0;background:transparent;color:#61544e;font-size:22px;line-height:1;padding:2px 7px;border-radius:6px}",
      ".yidu-close:hover,.yidu-close:focus-visible{background:#f4e8df;outline:none}",
      ".yidu-source{font-size:12px;color:#786c64;margin:12px 0;border-bottom:1px solid #eee5dd;padding-bottom:10px;overflow-wrap:anywhere}",
      ".yidu-body{font-size:15px;line-height:1.7;color:#25201d;white-space:pre-wrap;overflow-wrap:anywhere}",
      ".yidu-error{color:#a33f27}",
      ".yidu-settings{margin-top:12px;border:1px solid #b86144;background:#fffdf9;color:#a45032;border-radius:7px;padding:6px 10px;font-size:13px}"
    ].join("");
    selectionShadow.append(style);
    document.documentElement.append(selectionRoot);
  }

  function place(element, rect, gap) {
    const width = element.offsetWidth;
    const height = element.offsetHeight;
    const left = Math.max(12, Math.min(window.innerWidth - width - 12, rect.left));
    const below = rect.bottom + gap;
    const top = below + height <= window.innerHeight - 12
      ? below
      : Math.max(12, rect.top - height - gap);
    element.style.left = left + "px";
    element.style.top = top + "px";
  }

  function renderSelectionMenu() {
    ensureSelectionRoot();
    selectionShadow.querySelectorAll(".yidu-menu,.yidu-result").forEach((item) => item.remove());
    const menu = document.createElement("div");
    menu.className = "yidu-menu";
    menu.setAttribute("role", "group");
    menu.setAttribute("aria-label", "选中文字操作");
    for (const action of ["translate", "explain"]) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = action === "translate" ? "翻译" : "解释";
      button.addEventListener("pointerdown", (event) => event.preventDefault());
      button.addEventListener("click", () => void runSelectionAction(action));
      menu.append(button);
    }
    selectionShadow.append(menu);
    place(menu, selectedRect, 8);
  }

  async function runSelectionAction(action) {
    const text = selectedText;
    const rect = selectedRect;
    const currentRequest = ++requestId;
    selectionShadow.querySelector(".yidu-menu")?.remove();
    const box = document.createElement("section");
    box.className = "yidu-result";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-label", action === "translate" ? "划词翻译" : "划词解释");
    const head = document.createElement("div");
    head.className = "yidu-head";
    const heading = document.createElement("strong");
    heading.textContent = action === "translate" ? "翻译" : "解释";
    const close = document.createElement("button");
    close.type = "button";
    close.className = "yidu-close";
    close.setAttribute("aria-label", "关闭");
    close.textContent = "×";
    close.addEventListener("click", hideSelectionUi);
    head.append(heading, close);
    const source = document.createElement("p");
    source.className = "yidu-source";
    source.textContent = text;
    const body = document.createElement("div");
    body.className = "yidu-body";
    body.setAttribute("aria-live", "polite");
    body.textContent = action === "translate" ? "正在翻译…" : "正在解释…";
    box.append(head, source, body);
    selectionShadow.append(box);
    place(box, rect, 10);
    close.focus();
    try {
      const response = await chrome.runtime.sendMessage({
        type: "YIDU_SELECTION_ACTION",
        payload: { action, text }
      });
      if (requestId !== currentRequest || !box.isConnected) return;
      if (!response?.ok) throw Object.assign(new Error(response?.message || "请求失败，请重试。"), { code: response?.code });
      body.textContent = response.result;
    } catch (error) {
      if (requestId !== currentRequest || !box.isConnected) return;
      body.classList.add("yidu-error");
      body.textContent = error?.message || "请求失败，请重试。";
      if (error?.code === "SETUP_REQUIRED") {
        const settings = document.createElement("button");
        settings.type = "button";
        settings.className = "yidu-settings";
        settings.textContent = "打开设置";
        settings.addEventListener("click", () => void chrome.runtime.sendMessage({ type: "YIDU_OPEN_OPTIONS" }));
        box.append(settings);
      }
    }
    place(box, rect, 10);
  }

  function hideSelectionUi() {
    requestId += 1;
    selectionShadow?.querySelectorAll(".yidu-menu,.yidu-result").forEach((item) => item.remove());
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[character]);
  }
})();
