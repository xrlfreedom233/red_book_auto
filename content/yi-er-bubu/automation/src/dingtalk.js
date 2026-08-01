import crypto from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { postJson } from "./http.js";
import { PipelineError } from "./errors.js";

export function signDingTalk(timestamp, secret) {
  return crypto.createHmac("sha256", secret).update(`${timestamp}\n${secret}`).digest("base64");
}

export function notificationText(state) {
  const failed = Object.entries(state.stages).find(([, stage]) => stage.status === "failed");
  const draft = state.stages.xhsDraft.status;
  const outcome = state.result === "success" ? "生成成功" : state.result === "partial_failure" ? "部分失败" : "生成失败";
  return [
    `一二布布每日漫画：${outcome}`,
    `日期：${state.date}`,
    `运行 ID：${state.runId}`,
    `草稿状态：${draft}`,
    failed ? `失败阶段：${failed[0]}（${failed[1].error?.recoverable ? "可恢复" : "需人工处理"}）` : "发布包状态：待审核",
    "请人工检查图片、中文、连续性与草稿，再手动决定是否发布。"
  ].join("\n");
}

export async function sendNotification(config, state, runDir) {
  const body = { msgtype: "text", text: { content: notificationText(state) } };
  if (config.mock) {
    const directory = path.join(runDir, "notification");
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, "mock-request.json"), `${JSON.stringify(body, null, 2)}\n`, { mode: 0o600 });
    return { mocked: true };
  }
  if (!config.dingTalkWebhook) throw new PipelineError("DingTalk webhook is not configured", { category: "configuration" });
  let url;
  try {
    url = new URL(config.dingTalkWebhook);
  } catch (cause) {
    throw new PipelineError("DingTalk webhook is invalid", { category: "configuration", cause });
  }
  if (url.protocol !== "https:") throw new PipelineError("DingTalk webhook must use HTTPS", { category: "configuration" });
  if (config.dingTalkSecret) {
    const timestamp = Date.now().toString();
    url.searchParams.set("timestamp", timestamp);
    url.searchParams.set("sign", signDingTalk(timestamp, config.dingTalkSecret));
  }
  const response = await postJson(url, { body, timeoutMs: config.requestTimeoutMs, retries: config.maxRetries });
  if (response?.errcode !== undefined && response.errcode !== 0) {
    throw new PipelineError(`DingTalk rejected the notification (errcode ${response.errcode})`, { category: "external", recoverable: false });
  }
  return response;
}
