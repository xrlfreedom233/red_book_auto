import test from "node:test";
import assert from "node:assert/strict";
import { validateBubble, validateEpisode, validateQuality, validateTopic } from "../src/contracts.js";

test("topic contract normalizes valid values", () => {
  const topic = validateTopic({ column: " 日常 ", title: "热汤", emotion: "安心", scene: "厨房", conflict: "互相推让", ending: "一起喝完", keywords: ["热汤", "默契"] });
  assert.equal(topic.column, "日常");
  assert.throws(() => validateTopic({ ...topic, keywords: [] }), /keywords/);
});

test("bubble and quality contracts reject unsafe geometry and coerced booleans", () => {
  const bubble = { text: "你先喝", speaker: "一一", panel: "top", box: { x: 800, y: 150, width: 280, height: 140 }, tail: { x: 900, y: 400 } };
  assert.throws(() => validateBubble(bubble), /safe area/);
  assert.throws(() => validateQuality({ automatic: [{ name: "size", passed: "false", detail: "bad" }], manualReview: ["人工检查"] }), /boolean/);
});

test("episode contract enforces cover and story sequence", () => {
  const bubble = { text: "你先喝", speaker: "一一", panel: "top", box: { x: 150, y: 150, width: 280, height: 140 }, tail: { x: 300, y: 400 } };
  const pages = Array.from({ length: 5 }, (_, number) => ({ number, kind: number === 0 ? "cover" : "story", upper: "上格", lower: "下格", prompt: "无字双格画面提示", bubbles: number ? [bubble] : [] }));
  const episode = validateEpisode({ slug: "test", title: "测试", brief: "测试简报", pages, publish: { title: "测试标题", body: "测试正文", tags: ["原创"] } });
  assert.equal(episode.pages.length, 5);
  assert.throws(() => validateEpisode({ ...episode, pages: pages.slice(1) }), /pages/);
});
