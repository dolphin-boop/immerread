import assert from "node:assert/strict";
import test from "node:test";
import {
  containsTerm,
  glossaryForSegments,
  matchingGlossaryEntries,
  missingFixedTerms,
  prepareFixedTermRetry,
  restoreFixedTermRetry,
  normalizeGlossaryEntry,
  removeGlossaryEntry,
  segmentGlossarySignature,
  upsertGlossary
} from "../lib/glossary.js";

test("saves and updates user-confirmed translations case-insensitively", () => {
  const first = upsertGlossary({}, "AI Agent", "智能体", 100);
  const second = upsertGlossary(first, "ai agent", "AI 代理体", 200);
  assert.equal(Object.keys(second.entries).length, 1);
  assert.equal(second.entries["ai agent"].target, "AI 代理体");
  assert.equal(second.entries["ai agent"].updatedAt, 200);
});

test("removes only the selected user-maintained fixed translation", () => {
  const glossary = upsertGlossary(upsertGlossary({}, "agent", "智能体"), "model", "模型");
  const { glossary: remaining, removed } = removeGlossaryEntry(glossary, "AGENT");
  assert.equal(removed.target, "智能体");
  assert.deepEqual(Object.keys(remaining.entries), ["model"]);
  assert.equal(removeGlossaryEntry(remaining, "missing").removed, null);
});

test("rejects sentences and empty user translations", () => {
  assert.throws(() => normalizeGlossaryEntry("one two three four five six seven eight nine", "译文"), /8 个/);
  assert.throws(() => normalizeGlossaryEntry("agent", "  "), /请输入/);
});

test("matches exact terms rather than substrings and sends only relevant terms", () => {
  const glossary = upsertGlossary(upsertGlossary({}, "agent", "智能体"), "output", "输出结果");
  assert.equal(containsTerm("agents", "agent"), false);
  assert.equal(containsTerm("AI agents improve evaluations.", "agents"), true);
  assert.equal(containsTerm("An agent outputs a result.", "agent"), true);
  assert.deepEqual(matchingGlossaryEntries(glossary, "An agent outputs a result.").map((entry) => entry.source), ["agent"]);
  assert.deepEqual(glossaryForSegments(glossary, [{ text: "An agent outputs a result." }]), { agent: "智能体" });
  assert.equal(segmentGlossarySignature(glossary, { text: "No matching word." }), "");
});

test("does not match a multiword term across two article segments", () => {
  const glossary = upsertGlossary({}, "agent systems", "智能体系统");
  assert.deepEqual(glossaryForSegments(glossary, [{ text: "An agent" }, { text: "systems improve." }]), {});
});
test("repairs a model response that translated a locked English term into Chinese", () => {
  const glossary = upsertGlossary({}, "agents", "agents");
  const segments = [{ id: "title", text: "Demystifying evals for AI agents", markup: "<strong>Demystifying evals for AI agents</strong>" }];
  const initial = [{ id: "title", translation: "揭开 AI 智能体评测的神秘面纱", terms: [] }];
  assert.deepEqual(missingFixedTerms(glossary, segments, initial), [{ id: "title", source: "agents", target: "agents" }]);
  const retry = prepareFixedTermRetry(glossary, segments);
  assert.match(retry.segments[0].text, /__YIDU_TERM_0_0__/);
  assert.match(retry.segments[0].markup, /<strong>.*__YIDU_TERM_0_0__<\/strong>/);
  const repaired = restoreFixedTermRetry([{ id: "title", translation: "揭开 <strong>AI __YIDU_TERM_0_0__</strong> 评测的神秘面纱", terms: [] }], retry.replacements);
  assert.match(repaired[0].translation, /<strong>AI agents<\/strong>/);
  assert.deepEqual(missingFixedTerms(glossary, segments, repaired), []);
  assert.throws(() => restoreFixedTermRetry(initial, retry.replacements), /未保留固定译法/);
});

test("protects longer terms first and escapes user-selected HTML-like targets", () => {
  const glossary = upsertGlossary(upsertGlossary({}, "agents", "智能体"), "AI agents", "<AI agents>");
  const retry = prepareFixedTermRetry(glossary, [{ id: "one", text: "AI agents", markup: "<strong>AI agents</strong>" }]);
  assert.equal(retry.replacements.get("one").length, 1);
  const repaired = restoreFixedTermRetry([{ id: "one", translation: "<strong>__YIDU_TERM_0_0__</strong>" }], retry.replacements);
  assert.equal(repaired[0].translation, "<strong>&lt;AI agents&gt;</strong>");
});
