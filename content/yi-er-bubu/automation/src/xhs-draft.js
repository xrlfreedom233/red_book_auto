import { mkdir } from "node:fs/promises";
import path from "node:path";
import { PipelineError } from "./errors.js";

async function playwright() {
  try {
    return await import("playwright");
  } catch (cause) {
    throw new PipelineError("Playwright is not installed in this runtime", { category: "configuration", cause });
  }
}

async function assertSafePage(page) {
  const blocked = page.getByText(/验证码|安全验证|账号异常|风险提示|重新登录/).first();
  if (await blocked.isVisible().catch(() => false)) {
    throw new PipelineError("creator center requires human verification or login", { category: "human_verification", recoverable: true });
  }
}

export async function waitForUploadControl(page, timeoutMs) {
  const upload = page.locator('input[type="file"]').first();
  try {
    await upload.waitFor({ state: "attached", timeout: timeoutMs });
    return upload;
  } catch (cause) {
    await assertSafePage(page);
    throw new PipelineError("image upload control was not found", { category: "page_changed", recoverable: true, cause });
  }
}

const loopbackHosts = new Set(["127.0.0.1", "::1", "localhost"]);

export function validateDraftTarget(value, mock) {
  let target;
  try {
    target = new URL(value);
  } catch (cause) {
    throw new PipelineError("draft page URL is invalid", { category: "configuration", cause });
  }
  if (mock) {
    if (!loopbackHosts.has(target.hostname)) {
      throw new PipelineError("mock draft page must use a loopback host", { category: "configuration" });
    }
  } else if (target.protocol !== "https:" || target.hostname !== "creator.xiaohongshu.com") {
    throw new PipelineError("live draft page must use the Xiaohongshu creator HTTPS host", { category: "configuration" });
  }
  return target.href;
}

async function safeScreenshot(page, screenshot) {
  await page.locator('input[type="password"], input[type="tel"], img[alt*="头像"], [class*="avatar" i]').evaluateAll((elements) => {
    for (const element of elements) element.style.filter = "blur(18px)";
  }).catch(() => {});
  await page.screenshot({ path: screenshot, fullPage: true });
}

export async function saveDraft({ config, episode, imageFiles, runDir }) {
  const target = validateDraftTarget(config.mock ? config.mockXhsUrl : config.xhsCreateUrl, config.mock);
  const { chromium } = await playwright();
  await mkdir(config.profileRoot, { recursive: true });
  const context = await chromium.launchPersistentContext(config.profileRoot, { headless: true, locale: "zh-CN" });
  const page = context.pages()[0] ?? await context.newPage();
  const screenshot = path.join(runDir, "xhs-draft", "result.png");
  await mkdir(path.dirname(screenshot), { recursive: true });
  try {
    await page.goto(target, { waitUntil: "domcontentloaded", timeout: config.requestTimeoutMs });
    validateDraftTarget(page.url(), config.mock);
    await assertSafePage(page);
    const upload = await waitForUploadControl(page, config.requestTimeoutMs);
    validateDraftTarget(page.url(), config.mock);
    await assertSafePage(page);
    await upload.setInputFiles(imageFiles);
    await page.getByRole("textbox", { name: /标题/ }).fill(episode.publish.title);
    const body = page.getByRole("textbox", { name: /正文|描述|内容/ });
    await body.fill(`${episode.publish.body}\n${episode.publish.tags.map((tag) => `#${tag}`).join(" ")}`);
    const save = page.getByRole("button", { name: /^保存草稿$/ });
    if (await save.count() !== 1) throw new PipelineError("an unambiguous save-draft control was not found", { category: "page_changed", recoverable: true });
    await save.click();
    const confirmation = page.getByText(/已保存至草稿|草稿保存成功|保存成功/).first();
    await confirmation.waitFor({ state: "visible", timeout: 15000 }).catch(() => {
      throw new PipelineError("draft result could not be verified", { category: "result_unclear", recoverable: true });
    });
    await safeScreenshot(page, screenshot);
    return { status: "saved_pending_review", screenshot };
  } catch (error) {
    await safeScreenshot(page, screenshot).catch(() => {});
    throw error;
  } finally {
    await context.close();
  }
}

export async function interactiveLogin(config) {
  const target = validateDraftTarget(config.xhsCreateUrl, false);
  const { chromium } = await playwright();
  await mkdir(config.profileRoot, { recursive: true });
  const context = await chromium.launchPersistentContext(config.profileRoot, { headless: false, locale: "zh-CN" });
  const page = context.pages()[0] ?? await context.newPage();
  await page.goto(target, { waitUntil: "domcontentloaded" });
  validateDraftTarget(page.url(), false);
  process.stdout.write("请在浏览器中完成交互式登录；确认创作中心已打开后关闭浏览器窗口。\n");
  await new Promise((resolve) => context.on("close", resolve));
}
