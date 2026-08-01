import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { notificationText, sendNotification, signDingTalk } from "../src/dingtalk.js";
import { createState } from "../src/state.js";

test("DingTalk signature follows timestamp-newline-secret HMAC", () => {
  const timestamp = "1700000000000";
  const secret = "test-only-secret";
  const expected = crypto.createHmac("sha256", secret).update(`${timestamp}\n${secret}`).digest("base64");
  assert.equal(signDingTalk(timestamp, secret), expected);
  const url = new URL("https://oapi.dingtalk.com/robot/send");
  url.searchParams.set("sign", signDingTalk(timestamp, secret));
  assert.equal(url.searchParams.get("sign"), expected);
});

test("notifications distinguish partial and failed outcomes", () => {
  const state = createState("2026-08-02");
  state.result = "partial_failure";
  assert.match(notificationText(state), /部分失败/);
  state.result = "failed";
  assert.match(notificationText(state), /生成失败/);
});

test("live notification requires configuration and rejects DingTalk business errors", async () => {
  const state = createState("2026-08-02");
  await assert.rejects(sendNotification({ mock: false, dingTalkWebhook: "" }, state, "/tmp"), /not configured/);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ errcode: 310000, errmsg: "keywords not in content" }), { status: 200 });
  try {
    await assert.rejects(sendNotification({ mock: false, dingTalkWebhook: "https://oapi.dingtalk.com/robot/send", dingTalkSecret: "", requestTimeoutMs: 1000, maxRetries: 0 }, state, "/tmp"), /errcode 310000/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("notification says pending review and does not include configuration", () => {
  const state = createState("2026-08-02");
  state.stages.xhsDraft.status = "skipped";
  const text = notificationText(state);
  assert.match(text, /待审核/);
  assert.doesNotMatch(text, /secret|webhook|cookie/i);
});
