(() => {
  if (globalThis.__yiduArticleExtractorInstalled) return;
  globalThis.__yiduArticleExtractorInstalled = true;
  document.getElementById("yidu-selection-root")?.remove();

  const MAX_SEGMENT_CHARS = 1200;
  const BLOCK_SELECTOR = "h1, h2, h3, h4, h5, h6, p, blockquote, li, td, th";
  const EXCLUDED_SELECTOR = "nav, footer, aside, form, script, style, pre, code, figure, [aria-hidden='true']";
  let trackedBlocks = [];
  let trackedIndex = 0;
  let scrollFrame = 0;
  let lastSelectionKey = "";
  let cellNotes = new Map();

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "YIDU_REQUEST_SCROLL_SYNC") {
      scheduleScrollSync();
      sendResponse({ ok: true });
      return false;
    }
    if (message?.type === "YIDU_REQUEST_SELECTION_SYNC") {
      emitSelectionSync(true);
      sendResponse({ ok: true });
      return false;
    }
    if (message?.type === "YIDU_SCROLL_TO_SEGMENT") {
      const segmentId = String(message.payload?.segmentId || "");
      const index = trackedBlocks.findIndex((block) => block.ids.includes(segmentId));
      const block = trackedBlocks[index];
      if (!block) {
        sendResponse({ ok: false, message: "未找到对应的原文模块。" });
        return false;
      }
      trackedIndex = index;
      const top = window.scrollY + block.node.getBoundingClientRect().top - 80;
      window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
      window.setTimeout(scheduleScrollSync, 350);
      sendResponse({ ok: true });
      return false;
    }
    if (message?.type === "YIDU_RENDER_CELLS") {
      renderCellTranslations(message.payload?.items);
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
    document.querySelectorAll(".yidu-cell-translation").forEach((note) => note.remove());
    cellNotes = new Map();
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
          nextTrackedBlocks.push({ id: segment.id, ids: [segment.id], node: module, kind: "skipped" });
        }
        continue;
      }
      const semanticParent = node.parentElement?.closest("blockquote, li");
      if (semanticParent && semanticParent !== node) continue;
      if (node.matches("td, th") && node.querySelector("h1, h2, h3, h4, h5, h6, p, blockquote, li")) continue;
      let kind = getBlockKind(node);
      if (node.closest("table, [role='table'], [role='grid']")) kind = "cell";
      const prepared = prepareBlock(node);
      const accessibleTitle = kind === "h1" ? node.getAttribute("aria-label")?.trim() : "";
      const text = cleanHeadingStart(accessibleTitle || readableText(prepared), kind);
      if (text.length < 2) continue;
      const serialized = accessibleTitle
        ? { markup: escapeHtml(accessibleTitle), links: [] }
        : serializeInline(prepared);
      if (/^h[1-6]$/.test(kind)) serialized.markup = cleanHeadingStart(serialized.markup, kind);
      const chunks = text.length > MAX_SEGMENT_CHARS
        ? splitOversizedText(text).map((chunk) => ({ text: chunk, markup: escapeHtml(chunk), links: [] }))
        : [{ text, markup: serialized.markup, links: serialized.links }];
      const ids = [];
      chunks.forEach((chunk) => {
        const segment = { id: `s${segments.length + 1}`, kind, ...chunk };
        segments.push(segment);
        ids.push(segment.id);
      });
      nextTrackedBlocks.push({ id: ids[0], ids, node, kind });
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
    lastSelectionKey = "";
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
    try {
      void chrome.runtime.sendMessage({
        type: "YIDU_SOURCE_SCROLL",
        payload: { segmentId: current.id, ratio }
      }).catch(() => undefined);
    } catch {
      // 扩展重载后旧内容脚本的消息上下文可能已失效。
    }
  }
  function findComplexModule(node, container) {
    let parent = node.parentElement;
    let componentRoot = null;
    while (parent && parent !== container && parent !== document.body) {
      if (parent.matches("[aria-roledescription='carousel']") ||
        /carousel|slider|gallery|chart|graph|interactive/i.test(String(parent.className || ""))) {
        componentRoot = parent;
      }
      parent = parent.parentElement;
    }
    return componentRoot;
  }
  function stripTags(markup) {
    const template = document.createElement("template");
    template.innerHTML = String(markup || "");
    return (template.content.textContent || "").trim();
  }

  let cellStyleInjected = false;
  function ensureCellStyle() {
    if (cellStyleInjected) return;
    cellStyleInjected = true;
    const style = document.createElement("style");
    style.textContent = ".yidu-cell-translation{display:block;margin-top:3px;font-size:.8em;line-height:1.6;color:#8a847a;font-style:normal;font-weight:400;text-decoration:none}";
    document.head.append(style);
  }

  function renderCellTranslations(items) {
    if (!Array.isArray(items) || !items.length) return;
    ensureCellStyle();
    for (const item of items) {
      const id = String(item?.id || "");
      if (!id) continue;
      const block = trackedBlocks.find((entry) => entry.ids.includes(id));
      if (!block) continue;
      let note = cellNotes.get(id);
      if (!note || !note.isConnected) {
        note = document.createElement("span");
        note.className = "yidu-cell-translation";
        cellNotes.set(id, note);
        block.node.append(note);
      }
      note.textContent = stripTags(item.translation);
    }
  }

  function prepareBlock(node) {
    const clone = node.cloneNode(true);
    clone.querySelectorAll("[aria-hidden='true']").forEach((hidden) => hidden.remove());
    clone.querySelectorAll(".yidu-cell-translation").forEach((note) => note.remove());
    if (node.matches("li")) clone.querySelectorAll("ul, ol").forEach((list) => list.remove());
    return clone;
  }

  function cleanHeadingStart(value, kind) {
    return /^h[1-6]$/.test(kind) ? value.replace(/^\s*[:：]\s*/, "") : value;
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
    emitSelectionSync();
    if (event.key === "Escape") {
      dismissSelectionUi();
      return;
    }
    onSelectionChange();
  });
  document.addEventListener("pointerdown", (event) => {
    if (!selectionShadow?.querySelector(".yidu-menu,.yidu-result")) return;
    if (!event.composedPath().includes(selectionRoot)) dismissSelectionUi();
  }, true);

  function onSelectionChange(event) {
    if (event?.target && selectionRoot?.contains(event.target)) return;
    emitSelectionSync();
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

  function emitSelectionSync(force = false) {
    const selection = window.getSelection();
    const text = (selection?.toString() || "").replace(/\s+/g, " ").trim();
    let ids = [];
    if (text && /[A-Za-z]/.test(text) && selection?.rangeCount) {
      const start = selection.getRangeAt(0).startContainer;
      const element = start.nodeType === Node.ELEMENT_NODE ? start : start.parentElement;
      if (element && !element.closest("#yidu-selection-root, input, textarea, [contenteditable], [role='textbox']")) {
        const block = trackedBlocks.find((item) => item.node === element || item.node.contains(element));
        if (block?.kind !== "skipped") ids = block?.ids || [];
      }
    }
    const key = ids.join(",");
    if (!force && key === lastSelectionKey) return;
    lastSelectionKey = key;
    try {
      void chrome.runtime.sendMessage({
        type: "YIDU_SOURCE_SELECTION",
        payload: { segmentIds: ids }
      }).catch(() => undefined);
    } catch {
      // 仍允许打开划词浮窗，由浮窗给出刷新网页的恢复入口。
    }
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
      ".yidu-menu button:hover{background:#f4e8df}",
      ".yidu-menu button:focus-visible,.yidu-save:focus-visible,.yidu-reload:focus-visible{outline:3px solid rgba(39,107,166,.35);outline-offset:2px}",
      ".yidu-result{width:min(370px,calc(100vw - 24px));max-height:min(440px,calc(100vh - 24px));overflow:auto;overscroll-behavior:contain;padding:16px;box-sizing:border-box}",
      ".yidu-head{color:#a45032;font-size:14px;font-weight:700}",
      ".yidu-source{font-size:12px;color:#786c64;margin:12px 0;border-bottom:1px solid #eee5dd;padding-bottom:10px;overflow-wrap:anywhere}",
      ".yidu-body{font-size:15px;line-height:1.7;color:#25201d;white-space:pre-wrap;overflow-wrap:anywhere}",
      ".yidu-error{color:#a33f27}",
      ".yidu-settings,.yidu-reload{margin-top:12px;border:1px solid #b86144;background:#fffdf9;color:#a45032;border-radius:7px;padding:7px 11px;font-size:13px}",
      ".yidu-glossary-form{display:grid;gap:8px;margin-top:12px}",
      ".yidu-glossary-form label{font-size:13px;color:#61544e}",
      ".yidu-glossary-form input{min-height:38px;border:1px solid #d9c9bc;border-radius:7px;background:#fff;color:#25201d;padding:7px 10px;font:inherit;font-size:14px;box-sizing:border-box;min-width:0}",
      ".yidu-glossary-form input:focus-visible{outline:3px solid rgba(39,107,166,.35);outline-offset:2px}",
      ".yidu-save{justify-self:start;min-height:36px;border:0;border-radius:7px;background:#a45032;color:#fff;padding:7px 12px;font-size:13px;font-weight:600}",
      ".yidu-save:disabled{opacity:.65;cursor:wait}",
      ".yidu-feedback{font-size:13px;line-height:1.55;overflow-wrap:anywhere}",
      ".yidu-feedback:empty{display:none}"
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
    for (const action of ["translate", "explain", "glossary"]) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = action === "translate" ? "翻译" : action === "explain" ? "解释" : "固定译法";
      button.addEventListener("pointerdown", (event) => event.preventDefault());
      button.addEventListener("click", () => action === "glossary" ? openGlossaryForm() : void runSelectionAction(action));
      menu.append(button);
    }
    selectionShadow.append(menu);
    place(menu, selectedRect, 8);
  }

  function openGlossaryForm() {
    const text = selectedText;
    const rect = selectedRect;
    selectionShadow.querySelector(".yidu-menu")?.remove();
    const box = document.createElement("section");
    box.className = "yidu-result";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-label", "固定译法");
    const head = document.createElement("div");
    head.className = "yidu-head";
    const heading = document.createElement("strong");
    heading.textContent = "固定译法";
    head.append(heading);
    const source = document.createElement("p");
    source.className = "yidu-source";
    source.textContent = text;
    const form = document.createElement("form");
    form.className = "yidu-glossary-form";
    const label = document.createElement("label");
    label.textContent = "以后希望译为";
    label.htmlFor = "yidu-glossary-target";
    const input = document.createElement("input");
    input.id = "yidu-glossary-target";
    input.type = "text";
    input.maxLength = 80;
    input.required = true;
    input.placeholder = "输入指定译法…";
    const save = document.createElement("button");
    save.className = "yidu-save";
    save.type = "submit";
    save.textContent = "保存译法";
    const feedback = document.createElement("div");
    feedback.className = "yidu-feedback";
    feedback.setAttribute("role", "status");
    feedback.setAttribute("aria-live", "polite");
    form.append(label, input, save, feedback);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const target = input.value.trim();
      save.disabled = true;
      save.textContent = "保存中…";
      feedback.textContent = "";
      feedback.classList.remove("yidu-error");
      try {
        const response = await chrome.runtime.sendMessage({
          type: "YIDU_GLOSSARY_UPSERT",
          payload: { source: text, target }
        });
        if (!response?.ok) throw new Error(response?.message || "保存指定译法失败，请重试。");
        feedback.textContent = "已保存；右侧相关段落将重新翻译。";
        save.textContent = "更新译法";
      } catch (error) {
        showSelectionFailure(box, feedback, error);
        save.textContent = "重试保存";
      } finally {
        save.disabled = false;
        place(box, rect, 10);
      }
    });
    box.append(head, source, form);
    selectionShadow.append(box);
    place(box, rect, 10);
    input.focus();
  }

  function showSelectionFailure(box, target, error) {
    target.classList.add("yidu-error");
    const disconnected = /Extension context invalidated|context invalidated|Receiving end does not exist|message port closed/i.test(error?.message || "");
    target.textContent = disconnected
      ? "译读连接已失效。刷新当前网页后重试。"
      : error?.message || "请求失败，请重试。";
    if (disconnected && !box.querySelector(".yidu-reload")) {
      const reload = document.createElement("button");
      reload.type = "button";
      reload.className = "yidu-reload";
      reload.textContent = "刷新网页";
      reload.addEventListener("click", () => location.reload());
      box.append(reload);
    }
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
    head.append(heading);
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
      showSelectionFailure(box, body, error);
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

  function dismissSelectionUi() {
    hideSelectionUi();
    window.getSelection()?.removeAllRanges();
    selectedText = "";
    selectedRect = null;
    emitSelectionSync(true);
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
