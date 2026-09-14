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

    for (const node of nodes) {
      if (node.closest(EXCLUDED_SELECTOR)) continue;
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

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[character]);
  }
})();
