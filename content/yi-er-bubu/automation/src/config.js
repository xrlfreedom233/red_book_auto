import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PipelineError } from "./errors.js";

const automationDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const contentRoot = path.resolve(automationDir, "..");

async function readSecret(file, envName) {
  if (process.env[envName]) return process.env[envName].trim();
  if (!file) return "";
  try {
    return (await readFile(file, "utf8")).trim();
  } catch (error) {
    if (error.code === "ENOENT") return "";
    throw error;
  }
}

function positiveInteger(value, name, fallback) {
  const parsed = Number(value ?? fallback);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new PipelineError(`${name} must be a positive integer`, { category: "configuration" });
  }
  return parsed;
}

function nonNegativeInteger(value, name, fallback) {
  const parsed = Number(value ?? fallback);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new PipelineError(`${name} must be a non-negative integer`, { category: "configuration" });
  }
  return parsed;
}

export async function loadConfig(overrides = {}) {
  const dailyRoot = path.resolve(overrides.dailyRoot ?? process.env.DAILY_ROOT ?? path.join(contentRoot, "daily"));
  const mock = Boolean(overrides.mock);
  const referenceRoot = path.resolve(overrides.referenceRoot ?? process.env.CHARACTER_REFERENCE_ROOT ?? path.join(contentRoot, "references"));
  const characterSheetName = overrides.characterSheetName ?? process.env.CHARACTER_SHEET_NAME ?? "character-sheet.png";
  if (path.basename(characterSheetName) !== characterSheetName || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.png$/i.test(characterSheetName)) {
    throw new PipelineError("CHARACTER_SHEET_NAME must be a plain PNG filename", { category: "configuration" });
  }
  return {
    contentRoot,
    dailyRoot,
    profileRoot: path.resolve(overrides.profileRoot ?? process.env.XHS_PROFILE_ROOT ?? path.join(dailyRoot, "browser-profile")),
    referenceRoot,
    characterSheetName,
    characterSheetFile: path.join(referenceRoot, characterSheetName),
    mock,
    enableXhsDraft: overrides.enableXhsDraft ?? process.env.ENABLE_XHS_DRAFT === "true",
    textModel: process.env.ARK_TEXT_MODEL ?? "doubao-seed-2-1-pro-260628",
    imageModel: process.env.ARK_IMAGE_MODEL ?? "doubao-seedream-5-0-260128",
    arkApiKey: mock ? "" : await readSecret(process.env.ARK_API_KEY_FILE ?? "/run/secrets/ark_api_key", "ARK_API_KEY"),
    dingTalkWebhook: mock ? "" : await readSecret(process.env.DINGTALK_WEBHOOK_FILE ?? "/run/secrets/dingtalk_webhook", "DINGTALK_WEBHOOK"),
    dingTalkSecret: mock ? "" : await readSecret(process.env.DINGTALK_SECRET_FILE ?? "/run/secrets/dingtalk_secret", "DINGTALK_SECRET"),
    maxTextCalls: positiveInteger(process.env.MAX_TEXT_CALLS, "MAX_TEXT_CALLS", 4),
    maxImageCalls: positiveInteger(process.env.MAX_IMAGE_CALLS, "MAX_IMAGE_CALLS", 7),
    maxRetries: nonNegativeInteger(process.env.MAX_RETRIES, "MAX_RETRIES", 2),
    requestTimeoutMs: positiveInteger(process.env.REQUEST_TIMEOUT_MS, "REQUEST_TIMEOUT_MS", 120000),
    xhsCreateUrl: process.env.XHS_CREATE_URL ?? "https://creator.xiaohongshu.com/publish/publish",
    mockXhsUrl: overrides.mockXhsUrl ?? process.env.MOCK_XHS_URL ?? ""
  };
}
