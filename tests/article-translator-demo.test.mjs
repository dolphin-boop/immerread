import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const html = await readFile(new URL("../demo/article-translator/index.html", import.meta.url), "utf8");

test("renders paired English and Chinese article content", () => {
  assert.match(html, /ORIGINAL · ENGLISH/);
  assert.match(html, /TRANSLATION · 简体中文/);
  assert.equal((html.match(/class="pair"/g) ?? []).length, 4);
  assert.equal((html.match(/class="paragraph translated"/g) ?? []).length, 4);
  assert.doesNotMatch(html, /class="number"/);
  assert.doesNotMatch(html, /4 \/ 4 段/);
});

test("exposes the core demo interactions accessibly", () => {
  assert.match(html, /aria-label="阅读模式"/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /prefers-reduced-motion/);
});

test("keeps prohibited visual patterns out of the interface", () => {
  assert.doesNotMatch(html, /transition:\s*all/);
  assert.doesNotMatch(html, /font-style:\s*italic/);
  assert.doesNotMatch(html, /#[0]{6}\b/i);
  assert.doesNotMatch(html, /border-left:\s*[2-9]px/);
});
