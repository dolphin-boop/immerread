import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_API_BASE,
  buildTranslationMessages,
  getDefaultModel,
  normalizeApiBase,
  normalizeTerms,
  parseTranslationResponse
} from "../lib/translation.js";

test("builds a plain-text terminology-aware translation prompt", () => {
  const messages = buildTranslationMessages({
    title: "Building agents",
    segments: [{ id: "1", kind: "paragraph", text: "An agent uses tools.", markup: "An <strong>agent</strong> uses tools." }],
    glossary: { agent: "智能体" }
  });
  assert.equal(messages.length, 2);
  assert.match(messages[0].content, /agent => 智能体/);
  assert.match(messages[0].content, /纯文本译文/);
  assert.match(messages[0].content, /不得输出 HTML、Markdown/);
  assert.match(messages[0].content, /按中文习惯重组句式/);
  assert.match(messages[0].content, /不要逐词直译/);
  assert.match(messages[0].content, /输出前自行润色/);
  assert.match(messages[0].content, /不得省略事实、条件、转折或因果关系/);
  assert.match(messages[0].content, /定语链/);
  assert.match(messages[0].content, /主动句/);
  assert.match(messages[0].content, /地道中文/);
  assert.match(messages[0].content, /可能看起来像是/);
  assert.match(messages[0].content, /只收录 AI 和机器学习领域/);
  assert.match(messages[0].content, /不要把通用编程/);
  const payload = JSON.parse(messages[1].content);
  assert.deepEqual(payload.segments[0], { id: "1", kind: "paragraph", text: "An agent uses tools." });
});

test("defaults to the current DeepSeek model and normalizes the API base URL", () => {
  assert.equal(getDefaultModel(), "deepseek-flash");
  assert.equal(normalizeApiBase(""), DEFAULT_API_BASE);
  assert.equal(normalizeApiBase(null), DEFAULT_API_BASE);
  assert.equal(normalizeApiBase("https://api.deepseek.com/"), "https://api.deepseek.com");
  assert.equal(normalizeApiBase(" https://relay.example.com/v1/ "), "https://relay.example.com/v1");
  assert.equal(normalizeApiBase("http://localhost:8080/v1"), "http://localhost:8080/v1");
  assert.equal(normalizeApiBase("javascript:alert(1)"), DEFAULT_API_BASE);
  assert.equal(normalizeApiBase("not a url"), DEFAULT_API_BASE);
});

test("parses fenced JSON and keeps paragraph ids", () => {
  const result = parseTranslationResponse(
    '```json\n{"items":[{"id":"1","translation":"<strong>智能体</strong>使用工具。","terms":[{"source":"agent","target":"智能体"}]}]}\n```',
    ["1"]
  );
  assert.deepEqual(result, [{
    id: "1",
    translation: "<strong>智能体</strong>使用工具。",
    terms: [{ source: "agent", target: "智能体" }]
  }]);
});

test("deduplicates and removes invalid terminology", () => {
  assert.deepEqual(normalizeTerms([
    { source: "Agent", target: "智能体" },
    { source: "agent", target: "智能体" },
    { source: "API", target: "应用程序接口" },
    { source: "JavaScript", target: "JavaScript" },
    { source: "", target: "空" }
  ]), [{ source: "Agent", target: "智能体" }]);
});

test("rejects responses that cannot map to the source paragraph", () => {
  assert.throws(
    () => parseTranslationResponse('{"items":[{"id":"2","translation":"错误段落"}]}', ["1"]),
    /缺少对应段落/
  );
});

test("rejects partial or duplicate batch responses", () => {
  assert.throws(
    () => parseTranslationResponse('{"items":[{"id":"1","translation":"一"}]}', ["1", "2"]),
    /缺少对应段落/
  );
  assert.throws(
    () => parseTranslationResponse('{"items":[{"id":"1","translation":"一"},{"id":"1","translation":"重复"}]}', ["1"]),
    /缺少对应段落/
  );
});
