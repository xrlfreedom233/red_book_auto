import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { validateDraftTarget, waitForUploadControl } from "../src/xhs-draft.js";

function draftPage(upload, blocked = false) {
  return {
    locator(selector) {
      assert.equal(selector, 'input[type="file"]');
      return { first: () => upload };
    },
    getByText() {
      return { first: () => ({ isVisible: async () => blocked }) };
    }
  };
}

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

test("draft upload waits for a delayed hidden file input to attach", async () => {
  let attach;
  let settled = false;
  const upload = {
    waitFor(options) {
      assert.deepEqual(options, { state: "attached", timeout: 4321 });
      return new Promise((resolve) => { attach = resolve; });
    }
  };

  const waiting = waitForUploadControl(draftPage(upload), 4321).then((value) => {
    settled = true;
    return value;
  });
  await Promise.resolve();
  assert.equal(settled, false);
  attach();
  assert.equal(await waiting, upload);
});

test("draft upload timeout is a recoverable page-change failure", async () => {
  const upload = { waitFor: async () => { throw new Error("timeout"); } };
  await assert.rejects(waitForUploadControl(draftPage(upload), 25), (error) => {
    assert.equal(error.category, "page_changed");
    assert.equal(error.recoverable, true);
    assert.match(error.message, /upload control/);
    return true;
  });
});

test("draft upload timeout preserves human-verification classification", async () => {
  const upload = { waitFor: async () => { throw new Error("timeout"); } };
  await assert.rejects(waitForUploadControl(draftPage(upload, true), 25), (error) => {
    assert.equal(error.category, "human_verification");
    assert.equal(error.recoverable, true);
    return true;
  });
});
