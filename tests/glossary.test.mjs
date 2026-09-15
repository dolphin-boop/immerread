import assert from "node:assert/strict";
import test from "node:test";
import {
  containsTerm,
  glossaryForSegments,
  matchingGlossaryEntries,
  normalizeGlossaryEntry,
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