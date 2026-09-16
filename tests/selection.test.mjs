import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeSelectionPayload,
  buildSelectionMessages,
  cleanSelectionResponse
} from "../lib/selection.js";

test("selection actions accept only actively selected English text", () => {
  assert.deepEqual(normalizeSelectionPayload({
    action: "explain",
    text: "  AI agents   use  tools ",
    title: "Sensitive title",
    context: "Sensitive surrounding text"
  }), { action: "explain", text: "AI agents use tools" });
  assert.throws(() => normalizeSelectionPayload({ action: "save", text: "AI agents" }));
  assert.throws(() => normalizeSelectionPayload({ action: "explain", text: "纯中文" }));
});

test("translation and explanation prompts are separate and concise", () => {
  const payload = { text: "evaluation harness", title: "Private title", context: "Private context" };
  const explain = buildSelectionMessages({ ...payload, action: "explain" });
  const translate = buildSelectionMessages({ ...payload, action: "translate" });
  assert.match(explain[0].content, /中文解释/);
  assert.match(explain[0].content, /1–3 句/);
  assert.match(translate[0].content, /只输出译文/);
  assert.match(translate[0].content, /母语者/);
  assert.match(translate[0].content, /定语链/);
  assert.doesNotMatch(explain[1].content, /Private title|Private context/);
  assert.doesNotMatch(translate[1].content, /Private title|Private context/);
  assert.equal(explain[1].content, "选中的英文：evaluation harness");
});

test("empty model results are rejected", () => {
  assert.equal(cleanSelectionResponse("  简短中文解释。  "), "简短中文解释。");
  assert.throws(() => cleanSelectionResponse("   "));
});
