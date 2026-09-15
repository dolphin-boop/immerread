import { containsTerm } from "./lib/glossary.js";
import { groupArticleModules } from "./lib/summary.js";

(() => {
  const BATCH_SIZE = 4;
  const VIEWPORT_MARGIN = "520px 0px";
  const content = document.getElementById("content");
  const status = document.getElementById("status");
  const summaryContent = document.getElementById("summary-content");
  const glossaryForm = document.getElementById("glossary-form");
  const glossarySource = document.getElementById("glossary-source");
  const glossaryTarget = document.getElementById("glossary-target");
  const glossaryList = document.getElementById("glossary-list");
  const glossaryStatus = document.getElementById("glossary-status");
  const glossaryCancel = document.getElementById("glossary-cancel");
  const views = {
    translation: document.getElementById("view-translation"),
    summary: document.getElementById("view-summary"),
    glossary: document.getElementById("view-glossary")
  };
  const tabs = {
    translation: document.getElementById("tab-translation"),
    summary: document.getElementById("tab-summary"),
    glossary: document.getElementById("tab-glossary")
  };
  let activeView = "translation";
  let editingSource = "";
  let session = null;
  let reloadTimer = 0;

  document.getElementById("settings").addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "YIDU_OPEN_OPTIONS" });
  });
  for (const [name, tab] of Object.entries(tabs)) {
    tab.addEventListener("click", () => selectView(name));
    tab.addEventListener("keydown", (event) => {
      const names = Object.keys(tabs);
      const index = names.indexOf(name);
      const next = event.key === "ArrowRight" ? names[(index + 1) % names.length]
        : event.key === "ArrowLeft" ? names[(index + names.length - 1) % names.length]
        : event.key === "Home" ? names[0] : event.key === "End" ? names[names.length - 1] : "";
      if (!next) return;
      event.preventDefault();
      selectView(next);
      tabs[next].focus();
    });
  }
  glossaryForm.addEventListener("submit", saveGlossaryFromForm);
  glossaryCancel.addEventListener("click", resetGlossaryForm);
  chrome.tabs.onActivated.addListener(scheduleReload);
  chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
    if (changeInfo.status === "complete" && tab.active) scheduleReload();
  });
  chrome.runtime.onMessage.addListener((message, sender) => {
    if (message?.type === "YIDU_SOURCE_SCROLL") handleSourceScroll(message.payload, sender.tab?.id);
    if (message?.type === "YIDU_SOURCE_SELECTION") handleSourceSelection(message.payload, sender.tab?.id);
    if (message?.type === "YIDU_GLOSSARY_CHANGED") handleGlossaryChanged(message.payload);
    return false;
  });

  void loadActiveArticle();

  function selectView(name) {
    activeView = name;
    for (const [key, view] of Object.entries(views)) {
      const selected = key === name;
      view.hidden = !selected;
      tabs[key].setAttribute("aria-selected", String(selected));
      tabs[key].tabIndex = selected ? 0 : -1;
    }
    if (name === "glossary") void loadGlossaryEntries();
    if (name === "summary") {
      if (session) void runSummaries(session);
      else if (!summaryContent.childElementCount) showSummaryMessage("请先打开一篇英文网页文章。");
    }
  }

  function showSummaryMessage(message) {
    const note = document.createElement("p");
    note.className = "yidu-summary-note";
    note.textContent = message;
    summaryContent.replaceChildren(note);
  }

  function renderSummaryOutline(current) {
    const modules = groupArticleModules(current.article);
    current.summaryModules = modules;
    summaryContent.replaceChildren();
    const title = document.createElement("h1");
    title.className = "yidu-summary-title";
    title.textContent = current.article.title;
    const intro = document.createElement("p");
    intro.className = "yidu-view-intro";
    intro.textContent = modules.length + " 个大模块 · 按原文章节组织";
    const progress = document.createElement("p");
    progress.className = "yidu-summary-progress";
    current.summaryProgress = progress;
    summaryContent.append(title, intro, progress);
    if (!modules.length) {
      progress.textContent = "文章中没有可总结的正文。";
      return;
    }
    for (const [index, module] of modules.entries()) {
      const section = document.createElement("section");
      section.className = "yidu-summary-module";
      section.dataset.moduleId = module.id;
      const number = document.createElement("span");
      number.className = "yidu-summary-number";
      number.textContent = String(index + 1).padStart(2, "0");
      const details = document.createElement("div");
      details.className = "yidu-summary-details";
      const heading = document.createElement("h2");
      heading.textContent = module.title;
      const body = document.createElement("div");
      body.className = "yidu-summary-body";
      const pending = document.createElement("p");
      pending.className = "yidu-summary-pending";
      pending.textContent = "等待总结…";
      body.append(pending);
      details.append(heading, body);
      section.append(number, details);
      summaryContent.append(section);
    }
    updateSummaryProgress(current);
    if (activeView === "summary") void runSummaries(current);
  }

  function summaryBody(module) {
    return [...summaryContent.querySelectorAll(".yidu-summary-module")]
      .find((section) => section.dataset.moduleId === module.id)
      ?.querySelector(".yidu-summary-body");
  }

  function updateSummaryProgress(current) {
    if (!current.summaryProgress || current.stopped || !current.summaryModules.length) return;
    const done = current.summaryResults.size;
    const total = current.summaryModules.length;
    current.summaryProgress.textContent = (done === total
      ? "已总结 " + total + " 个模块"
      : "已总结 " + done + " / " + total + " 个模块") +
      (current.summaryCachedCount ? " · 缓存 " + current.summaryCachedCount : "") +
      (current.summaryCacheError ? " · 部分结果缓存失败" : "");
  }

  async function runSummaries(current) {
    if (current.stopped || current.summaryRunning || activeView !== "summary") return;
    current.summaryRunning = true;
    try {
      for (const module of current.summaryModules) {
        if (current.stopped || activeView !== "summary") break;
        if (current.summaryResults.has(module.id) || current.summaryFailed.has(module.id)) continue;
        const outcome = await summarizeOne(current, module);
        if (outcome?.code === "SETUP_REQUIRED") break;
      }
    } finally {
      current.summaryRunning = false;
    }
  }

  async function summarizeOne(current, module) {
    if (current.stopped || current.summaryInFlight.has(module.id)) return null;
    const body = summaryBody(module);
    if (!body) return null;
    current.summaryInFlight.add(module.id);
    body.setAttribute("aria-busy", "true");
    const pending = document.createElement("p");
    pending.className = "yidu-summary-pending";
    pending.textContent = "正在生成总结…";
    body.replaceChildren(pending);
    let outcome;
    try {
      outcome = await chrome.runtime.sendMessage({
        type: "YIDU_SUMMARIZE_MODULE",
        payload: { url: current.article.url, title: current.article.title, module }
      });
      if (current.stopped) return outcome;
      if (!outcome?.ok) throw new Error(outcome?.message || "总结失败，请重试。");
      current.summaryResults.set(module.id, outcome.result);
      const details = body.parentElement;
      details.querySelector("h2").textContent = outcome.result.title;
      const original = document.createElement("p");
      original.className = "yidu-summary-original";
      original.textContent = module.title;
      details.querySelector(".yidu-summary-original")?.remove();
      details.insertBefore(original, body);
      if (outcome.cached) current.summaryCachedCount += 1;
      if (outcome.cacheSaved === false) current.summaryCacheError = true;
      const summary = document.createElement("p");
      summary.className = "yidu-summary-overview";
      summary.textContent = outcome.result.summary;
      const points = document.createElement("ul");
      points.className = "yidu-summary-points";
      for (const point of outcome.result.points) {
        const item = document.createElement("li");
        item.textContent = point;
        points.append(item);
      }
      body.replaceChildren(summary, points);
      updateSummaryProgress(current);
    } catch (error) {
      if (!current.stopped) {
        current.summaryFailed.add(module.id);
        const message = document.createElement("p");
        message.className = "yidu-summary-failure";
        message.textContent = error?.message || "总结失败，请重试。";
        const actions = document.createElement("div");
        actions.className = "yidu-actions";
        if (outcome?.code === "SETUP_REQUIRED") {
          const settings = document.createElement("button");
          settings.className = "yidu-action secondary";
          settings.type = "button";
          settings.textContent = "打开设置";
          settings.addEventListener("click", () => chrome.runtime.sendMessage({ type: "YIDU_OPEN_OPTIONS" }));
          actions.append(settings);
        }
        const retry = document.createElement("button");
        retry.className = "yidu-action secondary";
        retry.type = "button";
        retry.textContent = "重试";
        retry.addEventListener("click", () => {
          current.summaryFailed.delete(module.id);
          void summarizeOne(current, module).then((result) => {
            if (result?.ok) void runSummaries(current);
          });
        });
        actions.append(retry);
        body.replaceChildren(message, actions);
      }
    } finally {
      current.summaryInFlight.delete(module.id);
      body.removeAttribute("aria-busy");
    }
    return outcome;
  }

  function resetGlossaryForm() {
    editingSource = "";
    glossaryForm.reset();
    glossarySource.readOnly = false;
    glossaryCancel.hidden = true;
    glossaryForm.querySelector('button[type="submit"]').textContent = "保存译法";
  }

  async function saveGlossaryFromForm(event) {
    event.preventDefault();
    const button = glossaryForm.querySelector('button[type="submit"]');
    button.disabled = true;
    glossaryStatus.textContent = "正在保存…";
    try {
      const result = await chrome.runtime.sendMessage({
        type: "YIDU_GLOSSARY_UPSERT",
        payload: { source: editingSource || glossarySource.value, target: glossaryTarget.value }
      });
      if (!result?.ok) throw new Error(result?.message || "保存失败");
      resetGlossaryForm();
      await loadGlossaryEntries();
      glossaryStatus.textContent = "固定译法已保存。";
    } catch (error) {
      glossaryStatus.textContent = error?.message || "保存失败，请重试。";
    } finally {
      button.disabled = false;
    }
  }

  async function loadGlossaryEntries() {
    try {
      const result = await chrome.runtime.sendMessage({ type: "YIDU_GLOSSARY_GET" });
      if (!result?.ok) throw new Error(result?.message || "读取失败");
      glossaryList.replaceChildren();
      const entries = (result.entries || []).sort((left, right) =>
        left.source.toLocaleLowerCase().localeCompare(right.source.toLocaleLowerCase()));
      if (!entries.length) {
        const empty = document.createElement("p");
        empty.className = "yidu-glossary-empty";
        empty.textContent = "还没有固定译法。可在这里添加，也可在原网页选词后保存。";
        glossaryList.append(empty);
      }
      for (const entry of entries) {
        const row = document.createElement("div");
        row.className = "yidu-glossary-entry";
        const words = document.createElement("div");
        words.className = "yidu-glossary-words";
        const source = document.createElement("strong");
        source.textContent = entry.source;
        const arrow = document.createElement("span");
        arrow.textContent = "→";
        const target = document.createElement("span");
        target.textContent = entry.target;
        words.append(source, arrow, target);
        const actions = document.createElement("div");
        actions.className = "yidu-glossary-actions";
        const edit = document.createElement("button");
        edit.type = "button";
        edit.textContent = "编辑";
        edit.addEventListener("click", () => {
          editingSource = entry.source;
          glossarySource.value = entry.source;
          glossarySource.readOnly = true;
          glossaryTarget.value = entry.target;
          glossaryCancel.hidden = false;
          glossaryForm.querySelector('button[type="submit"]').textContent = "更新译法";
          glossaryTarget.focus();
        });
        const remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = "删除";
        remove.addEventListener("click", async () => {
          remove.disabled = true;
          const result = await chrome.runtime.sendMessage({
            type: "YIDU_GLOSSARY_DELETE",
            payload: { source: entry.source }
          }).catch(() => null);
          if (result?.ok) {
            if (editingSource.toLocaleLowerCase() === entry.source.toLocaleLowerCase()) resetGlossaryForm();
            await loadGlossaryEntries();
            glossaryStatus.textContent = "固定译法已删除。";
          } else {
            glossaryStatus.textContent = result?.message || "删除失败，请重试。";
            remove.disabled = false;
          }
        });
        actions.append(edit, remove);
        row.append(words, actions);
        glossaryList.append(row);
      }
    } catch (error) {
      glossaryStatus.textContent = error?.message || "读取固定译法失败。";
    }
  }

  function scheduleReload() {
    window.clearTimeout(reloadTimer);
    reloadTimer = window.setTimeout(() => void loadActiveArticle(), 120);
  }

  function handleSourceScroll(payload, tabId) {
    const current = session;
    if (!current || current.stopped || tabId !== current.tabId) return;
    const row = current.rows.get(String(payload?.segmentId || ""));
    if (!row || activeView !== "translation") return;
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
  function handleSourceSelection(payload, tabId) {
    const current = session;
    if (!current || current.stopped || tabId !== current.tabId) return;
    const ids = new Set(
      (Array.isArray(payload?.segmentIds) ? payload.segmentIds : [])
        .map(String)
        .filter((id) => current.segmentsById.get(id)?.kind !== "skipped" && current.rows.has(id))
    );
    const previous = current.selectedSegmentIds;
    if (ids.size === previous.size && [...ids].every((id) => previous.has(id))) return;
    for (const id of previous) current.rows.get(id)?.classList.remove("yidu-source-selected");
    for (const id of ids) current.rows.get(id)?.classList.add("yidu-source-selected");
    current.selectedSegmentIds = ids;
    const first = current.rows.get(ids.values().next().value);
    if (first && activeView === "translation") {
      requestAnimationFrame(() => {
        if (!current.stopped && current.selectedSegmentIds.has(first.dataset.segmentId)) {
          first.scrollIntoView({ block: "center", behavior: "auto" });
        }
      });
    }
  }
  function handleGlossaryChanged(payload) {
    if (activeView === "glossary") void loadGlossaryEntries();
    const current = session;
    const source = String(payload?.source || "").trim();
    if (!current || current.stopped || !source) return;
    for (const key of Object.keys(current.glossary)) {
      if (key.toLocaleLowerCase() === source.toLocaleLowerCase()) delete current.glossary[key];
    }
    if (payload?.target) current.glossary[source] = String(payload.target);
    current.glossaryEpoch += 1;
    if (current.failed) {
      current.failed = false;
      document.querySelector(".yidu-error")?.remove();
      current.failedSegments.splice(0).forEach((segment) => enqueue(current, segment));
    }
    for (const segment of current.article.segments) {
      if (segment.kind === "skipped" || !containsTerm(segment.text, source)) continue;
      if (current.completed.delete(segment.id)) {
        const row = current.rows.get(segment.id);
        row?.classList.add("yidu-refreshing");
        row?.setAttribute("aria-busy", "true");
        enqueue(current, segment);
      } else if (current.selectedSegmentIds.has(segment.id)) {
        enqueue(current, segment);
      }
    }
  }

  async function loadActiveArticle() {
    stopSession();
    setStatus("正在读取文章…");
    content.setAttribute("aria-busy", "true");
    content.replaceChildren();
    summaryContent.replaceChildren();
    try {
      const tab = await findArticleTab();
      if (!tab?.id) throw new Error("请先打开一篇英文网页文章。");
      const response = await getArticleFromTab(tab.id);
      if (!response?.ok || !response.article?.segments?.length) {
        throw new Error(response?.message || "没有识别到可翻译的英文文章正文。");
      }
      startSession(response.article, tab.id);
    } catch (error) {
      const message = error?.message || "无法读取当前页面。";
      showEmpty(message, true);
      showSummaryMessage(message);
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
    try {
      return await chrome.tabs.sendMessage(tabId, { type: "YIDU_GET_ARTICLE" });
    } catch {
      // The receiver disappears when an unpacked extension is reloaded while the
      // article tab stays open. Ask the service worker to inject it again.
    }

    const prepared = await chrome.runtime.sendMessage({
      type: "YIDU_PREPARE_TAB",
      payload: { tabId }
    });
    if (!prepared?.ok) {
      return prepared || { ok: false, message: "无法读取当前页面，请刷新页面后重试。" };
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await chrome.tabs.sendMessage(tabId, { type: "YIDU_GET_ARTICLE" });
      } catch {
        await delay(180);
      }
    }
    return { ok: false, message: "页面连接失败，请刷新文章页面后重试。" };
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
      summaryModules: [],
      summaryResults: new Map(),
      summaryFailed: new Set(),
      summaryInFlight: new Set(),
      summaryRunning: false,
      summaryCachedCount: 0,
      summaryCacheError: false,
      summaryProgress: null,
      selectedSegmentIds: new Set(),
      glossaryEpoch: 0
    };
    session = next;
    renderArticle(next);
    renderSummaryOutline(next);
    void restoreCache(next).then(() => {
      if (next.stopped) return;
      startViewportTranslation(next);
      void chrome.tabs.sendMessage(next.tabId, { type: "YIDU_REQUEST_SCROLL_SYNC" }).catch(() => undefined);
      void chrome.tabs.sendMessage(next.tabId, { type: "YIDU_REQUEST_SELECTION_SYNC" }).catch(() => undefined);
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
      if (segment.kind === "skipped") {
        element.textContent = segment.text;
        element.classList.remove("yidu-pending");
        element.removeAttribute("aria-busy");
        current.completed.add(segment.id);
      }
      element.dataset.segmentId = segment.id;
      if (segment.kind !== "skipped") element.setAttribute("aria-busy", "true");
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
    if (current.stopped || current.failed || segment.kind === "skipped" || current.completed.has(segment.id) || current.queued.has(segment.id)) return;
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
        const epoch = current.glossaryEpoch;
        const result = await chrome.runtime.sendMessage({
          type: "YIDU_TRANSLATE_BATCH",
          payload: { title: current.article.title, segments, glossary: current.glossary }
        });
        if (!result?.ok) throw Object.assign(new Error(result?.message || "翻译失败"), { code: result?.code });
        if (current.stopped) return;
        if (epoch !== current.glossaryEpoch) {
          segments.forEach((segment) => enqueue(current, segment));
          continue;
        }
        for (const item of result.items) applyTranslation(current, item, false);
        void chrome.runtime.sendMessage({
          type: "YIDU_CACHE_PUT",
          payload: { url: current.article.url, segments, items: result.items, glossarySnapshot: result.glossarySnapshot }
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
    const fragment = buildSafeFragment(item.translation, segment);
    if (/^h[1-6]$/.test(segment.kind)) cleanHeadingFragment(fragment);
    row.replaceChildren(fragment);
    if (current.completed.has(id)) {
      row.classList.remove("yidu-pending", "yidu-refreshing");
      row.removeAttribute("aria-busy");
      row.dataset.translated = "true";
    }
  }

  function cleanHeadingFragment(fragment) {
    const walker = document.createTreeWalker(fragment, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (!node.nodeValue.trim()) continue;
      node.nodeValue = node.nodeValue.replace(/^\s*[:：]\s*/, "");
      if (node.nodeValue.trim()) break;
    }
  }

  function buildSafeFragment(markup, segment) {
    const template = document.createElement("template");
    template.innerHTML = String(markup || "");
    const fragment = document.createDocumentFragment();
    for (const node of template.content.childNodes) {
      const safe = sanitizeNode(node, segment);
      if (safe) fragment.append(safe);
    }
    return fragment;
  }

  function sanitizeNode(node, segment) {
    if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.nodeValue || "");
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
      if (!href) return copyChildren(node, document.createDocumentFragment(), segment);
      element = document.createElement("a");
      element.href = href;
      element.target = "_blank";
      element.rel = "noopener noreferrer";
    } else return copyChildren(node, document.createDocumentFragment(), segment);
    return copyChildren(node, element, segment);
  }

  function copyChildren(source, target, segment) {
    for (const child of source.childNodes) {
      const safe = sanitizeNode(child, segment);
      if (safe) target.append(safe);
    }
    return target;
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
