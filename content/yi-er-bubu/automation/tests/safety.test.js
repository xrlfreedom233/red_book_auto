import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { activateImageUpload, fillDraftBody, validateDraftTarget, waitForUploadControl } from "../src/xhs-draft.js";

function draftPage(upload, { blocked = false, imageMode } = {}) {
  return {
    locator(selector) {
      assert.match(selector, /accept\*="\.png"/);
      assert.doesNotMatch(selector, /^input\[type="file"\]$/);
      return { first: () => upload };
    },
    getByText(matcher, options) {
      if (matcher === "上传图文") {
        assert.deepEqual(options, { exact: true });
        return imageMode;
      }
      return { first: () => ({ isVisible: async () => blocked }) };
    }
  };
}

test("browser automation exposes only image-mode and save-draft actions", async () => {
  const source = await readFile(path.resolve("src/xhs-draft.js"), "utf8");
  const buttonActions = [...source.matchAll(/getByRole\("button"/g)];
  assert.equal(buttonActions.length, 0);
  assert.equal([...source.matchAll(/\.click\(/g)].length, 2);
  assert.equal([...source.matchAll(/click\(\{ trial: true,/g)].length, 1);
  assert.equal([...source.matchAll(/clickUniqueExactText\(page, "上传图文"/g)].length, 1);
  assert.equal([...source.matchAll(/clickUniqueExactText\(page, "暂存离开"/g)].length, 1);
  assert.doesNotMatch(source, /发布笔记/);
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

test("draft upload switches to the exact image-note mode", async () => {
  const clicks = [0, 0, 0];
  const candidates = [false, true, false].map((actionable, index) => ({
    async click(options) {
      if (options.trial) {
        assert.equal(options.timeout, 3000);
        if (!actionable) throw new Error("not actionable");
        return;
      }
      assert.deepEqual(options, { timeout: 4321 });
      clicks[index] += 1;
    }
  }));
  const imageMode = {
    first: () => ({ waitFor: async (options) => assert.deepEqual(options, { state: "attached", timeout: 4321 }) }),
    count: async () => candidates.length,
    nth: (index) => candidates[index]
  };
  await activateImageUpload(draftPage(null, { imageMode }), 4321);
  assert.deepEqual(clicks, [0, 1, 0]);
});

test("draft upload rejects an ambiguous image-note mode", async () => {
  let realClicks = 0;
  const candidate = {
    async click(options) {
      if (!options.trial) realClicks += 1;
    }
  };
  const imageMode = {
    first: () => ({ waitFor: async () => {} }),
    count: async () => 2,
    nth: () => candidate
  };
  await assert.rejects(activateImageUpload(draftPage(null, { imageMode }), 25), (error) => {
    assert.equal(error.category, "page_changed");
    assert.equal(error.recoverable, true);
    return true;
  });
  assert.equal(realClicks, 0);
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
  await assert.rejects(waitForUploadControl(draftPage(upload, { blocked: true }), 25), (error) => {
    assert.equal(error.category, "human_verification");
    assert.equal(error.recoverable, true);
    return true;
  });
});

test("draft body uses the observed ProseMirror textbox contract", async () => {
  let filled = "";
  let pressed = "";
  const body = {
    waitFor: async (options) => assert.deepEqual(options, { state: "visible", timeout: 4321 }),
    count: async () => 1,
    fill: async (text, options) => {
      filled = text;
      assert.deepEqual(options, { timeout: 4321 });
    }
  };
  const page = {
    locator(selector) {
      assert.equal(selector, 'div.tiptap.ProseMirror[contenteditable="true"][role="textbox"]');
      return body;
    },
    keyboard: { press: async (key) => { pressed = key; } }
  };
  await fillDraftBody(page, "正文\n#话题", 4321);
  assert.equal(filled, "正文\n#话题");
  assert.equal(pressed, "Escape");
});
