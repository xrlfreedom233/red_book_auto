import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { validateDraftTarget } from "../src/xhs-draft.js";

test("browser automation exposes exactly the save-draft button action", async () => {
  const source = await readFile(path.resolve("src/xhs-draft.js"), "utf8");
  const buttonActions = [...source.matchAll(/getByRole\("button"/g)];
  assert.equal(buttonActions.length, 1);
  assert.match(source, /保存草稿/);
  assert.doesNotMatch(source, /route\(|request\.post|context\.cookies|document\.cookie/);
});

test("draft targets are pinned to creator host in live mode and loopback in mock mode", () => {
  assert.match(validateDraftTarget("https://creator.xiaohongshu.com/publish/publish", false), /^https:/);
  assert.match(validateDraftTarget("http://127.0.0.1:4321/fake", true), /^http:/);
  assert.throws(() => validateDraftTarget("https://example.com/fake", false), /Xiaohongshu creator/);
  assert.throws(() => validateDraftTarget("https://creator.xiaohongshu.com/publish/publish", true), /loopback/);
  assert.throws(() => validateDraftTarget("", true), /invalid/);
});
