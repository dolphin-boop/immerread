import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSummaryMessages,
  groupArticleModules,
  makeSummaryKey,
  parseSummaryResponse,
  readCachedSummary,
  saveCachedSummary
} from "../lib/summary.js";

test("groups article text by major headings and covers long sections in order", () => {
  const segments = [
    { id: "s1", kind: "h1", text: "Article title" },
    { id: "s2", kind: "paragraph", text: "Introduction" },
    { id: "s3", kind: "h2", text: "Methods" },
    { id: "s4", kind: "paragraph", text: "A".repeat(4500) },
    { id: "s5", kind: "paragraph", text: "B".repeat(4500) },
    { id: "s6", kind: "h2", text: "Results" },
    { id: "s7", kind: "paragraph", text: "Results text" },
    { id: "s8", kind: "skipped", text: "Complex carousel" }
  ];
  const modules = groupArticleModules({ segments });
  assert.deepEqual(modules.map((module) => module.title), [
    "导读", "Methods", "Methods（第 2 部分）", "Results"
  ]);
  assert.deepEqual(modules.flatMap((module) => module.segments.map((segment) => segment.id)),
    ["s2", "s3", "s4", "s5", "s6", "s7"]);
  assert.ok(modules.every((module) => module.segments.reduce((size, segment) => size + segment.text.length, 0) <= 8000));
});

test("falls back to sequential parts when the article has no section headings", () => {
  const modules = groupArticleModules({ segments: [
    { id: "a", kind: "paragraph", text: "A".repeat(5000) },
    { id: "b", kind: "paragraph", text: "B".repeat(5000) }
  ] });
  assert.deepEqual(modules.map((module) => module.title), ["第 1 部分", "第 2 部分"]);
});

test("summary prompt limits the model to the current module and validates structured output", () => {
  const module = { title: "Methods", segments: [{ id: "s1", kind: "paragraph", text: "Evaluation method." }] };
  const messages = buildSummaryMessages({ articleTitle: "Agents", module });
  assert.match(messages[0].content, /不要概括未提供的章节/);
  assert.doesNotMatch(messages[0].content, /固定译法/);
  assert.doesNotMatch(messages[1].content, /glossary|url|Other chapter/);
  assert.match(messages[0].content, /一到三句/);
  assert.deepEqual(parseSummaryResponse('{"title":"评测方法","summary":"介绍评测方法。补充关键结论。再补一句重点。第四句多余细节会被去掉。","points":["多余要点"]}'), {
    title: "评测方法", summary: "介绍评测方法。补充关键结论。再补一句重点。"
  });
  assert.deepEqual(parseSummaryResponse('{"result":{"heading":"评测方法","overview":"简短概述"}}'), {
    title: "评测方法", summary: "简短概述"
  });
  assert.deepEqual(parseSummaryResponse('{"content":"简短概述"}', "Methods"), {
    title: "Methods", summary: "简短概述"
  });
  assert.throws(() => parseSummaryResponse('{"title":"","summary":""}'), /格式不正确/);
});

test("summary cache changes with source text and expires", () => {
  const module = { title: "Methods", segments: [{ kind: "paragraph", text: "Source" }] };
  const key = makeSummaryKey("https://example.com/a#part", module, "deepseek-chat");
  const cache = saveCachedSummary({}, key, { title: "模块", summary: "概述" }, 100);
  assert.deepEqual(readCachedSummary(cache, key, 101), { title: "模块", summary: "概述" });
  const updated = saveCachedSummary(cache, key, { title: "新模块", summary: "新概述" }, 102);
  assert.deepEqual(readCachedSummary(updated, key, 103), { title: "新模块", summary: "新概述" });
  assert.equal(readCachedSummary(cache, key, 100 + 31 * 24 * 60 * 60 * 1000), null);
  assert.equal(readCachedSummary({ entries: { [key]: { updatedAt: 100,
    result: { title: "", summary: "损坏" } } } }, key, 101), null);
  assert.notEqual(key, makeSummaryKey("https://example.com/a", { ...module,
    segments: [{ kind: "paragraph", text: "Changed" }] }, "deepseek-chat"));
  assert.notEqual(makeSummaryKey("https://example.com/a", module, "deepseek-chat", "Old title"),
    makeSummaryKey("https://example.com/a", module, "deepseek-chat", "New title"));
});

