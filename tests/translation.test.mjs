import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTranslationMessages,
  normalizeTerms,
  parseTranslationResponse
} from "../lib/translation.js";

test("builds a terminology-aware translation prompt", () => {
  const messages = buildTranslationMessages({
    title: "Building agents",
    segments: [{ id: "1", text: "An agent uses tools." }],
    glossary: { agent: "智能体" }
  });
  assert.equal(messages.length, 2);
  assert.match(messages[0].content, /agent => 智能体/);
  assert.match(messages[0].content, /只返回 JSON/);
});

test("parses fenced JSON and keeps paragraph ids", () => {
  const result = parseTranslationResponse(
    '```json\n{"items":[{"id":"1","translation":"智能体使用工具。","terms":[{"source":"agent","target":"智能体"}]}]}\n```',
    ["1"]
  );
  assert.deepEqual(result, [{
    id: "1",
    translation: "智能体使用工具。",
    terms: [{ source: "agent", target: "智能体" }]
  }]);
});

test("deduplicates and removes invalid terminology", () => {
  assert.deepEqual(normalizeTerms([
    { source: "Agent", target: "智能体" },
    { source: "agent", target: "智能体" },
    { source: "", target: "空" }
  ]), [{ source: "Agent", target: "智能体" }]);
});

test("rejects responses that cannot map to the source paragraph", () => {
  assert.throws(
    () => parseTranslationResponse('{"items":[{"id":"2","translation":"错误段落"}]}', ["1"]),
    /缺少对应段落/
  );
});
