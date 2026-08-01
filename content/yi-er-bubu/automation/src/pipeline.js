import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { callStructuredText } from "./ark.js";
import { validateEpisode, validateTopic } from "./contracts.js";
import { generatePageImage, loadCharacterReference } from "./seedream.js";
import { appendHistory, findDuplicate, readHistory, topicFingerprint } from "./topic-history.js";
import { writeOverlay } from "./overlay.js";
import { runQualityChecks } from "./quality.js";
import { saveDraft } from "./xhs-draft.js";
import { sendNotification } from "./dingtalk.js";
import { PipelineError } from "./errors.js";
import { acquireDateLock, digest, invalidateFrom, loadOrCreateState, saveState, shouldRun, STAGES } from "./state.js";

const execFileAsync = promisify(execFile);
const systemPrompt = "你是一二布布原创治愈情侣日常漫画编剧。只返回符合要求的 JSON；画面提示不得含对白文字、品牌或权利方暗示。";

function safeError(error) {
  const message = String(error.message ?? error)
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/((?:cookie|token|secret|sign|authorization|api[_-]?key)\s*[=:]\s*)[^\s&,;]+/gi, "$1[redacted]")
    .replace(/([?&](?:token|secret|sign|access_token|api_key)=)[^&\s]+/gi, "$1[redacted]")
    .replace(/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi, "[redacted-image-data]")
    .slice(0, 500);
  return { message, category: error.category ?? "internal", recoverable: Boolean(error.recoverable) };
}

function mockTopic(date) {
  return { column: "生活小默契", title: `${date.slice(5)}的最后一口热汤`, emotion: "疲惫后被轻轻照顾", scene: "晚饭后的厨房", conflict: "两个人都说自己不饿却悄悄留给对方", ending: "最后发现碗底还藏着一颗爱心胡萝卜", keywords: [date, "热汤", "留一口", "厨房"] };
}

function mockBubble(text, speaker, panel, x) {
  const top = panel === "top";
  return { text, speaker, panel, box: { x, y: top ? 135 : 790, width: 300, height: 150 }, tail: { x: x + 150, y: top ? 380 : 1035 } };
}

function mockEpisode(date, topic) {
  const page = (number, kind, first, second) => ({
    number, kind, upper: `厨房里，${first}`, lower: second, prompt: `原创治愈系情侣日常，暖色厨房，上格${first}，下格${second}，角色造型稳定`,
    bubbles: number === 0 ? [] : [mockBubble(number % 2 ? "你先喝。" : "明明是你先。", number % 2 ? "一一" : "布布", "top", number % 2 ? 150 : 600), mockBubble("那就一人一半。", "布布", "bottom", 390)]
  });
  return {
    slug: `warm-soup-${date}`, title: topic.title, brief: "一碗被互相推让的热汤，让普通晚饭变成温柔默契。",
    pages: [
      page(0, "cover", "两个人端着同一碗热汤", "对视后一起笑起来"),
      page(1, "story", "一一把最后一碗汤推过去", "布布假装低头收拾桌面"),
      page(2, "story", "布布把碗悄悄推回来", "一一发现碗的位置变了"),
      page(3, "story", "两个人同时把碗推向对方", "手指在桌面中间碰到一起"),
      page(4, "story", "他们把汤分进两个小杯", "碗底露出爱心胡萝卜")
    ],
    publish: { title: "最后一口，留给你", body: "嘴上都说不饿，其实只是想把暖和的那一口留给对方。普通日子的小默契，也会悄悄发光。", tags: ["一二布布", "治愈漫画", "情侣日常", "原创漫画"] }
  };
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

function attemptFile(directory, pageNumber, extension, attempt) {
  const base = String(pageNumber).padStart(2, "0");
  return path.join(directory, `${base}${attempt > 1 ? `-candidate-${attempt}` : ""}.${extension}`);
}

async function runStage({ state, stage, input, runDir, resume, action }) {
  const inputDigest = digest(input);
  const current = state.stages[stage];
  if (!shouldRun(current, inputDigest, resume)) return current.output;
  if (current.inputDigest && current.inputDigest !== inputDigest) current.output = "";
  current.status = "running";
  current.attempts += 1;
  current.inputDigest = inputDigest;
  current.error = null;
  current.updatedAt = new Date().toISOString();
  await saveState(runDir, state);
  try {
    current.output = await action(current.attempts, current);
    current.status = "passed";
    current.updatedAt = new Date().toISOString();
    await saveState(runDir, state);
    return current.output;
  } catch (error) {
    current.status = "failed";
    current.error = safeError(error);
    current.updatedAt = new Date().toISOString();
    await saveState(runDir, state);
    throw error;
  }
}

async function loadTopic(output) {
  return readJson(output);
}

async function loadEpisode(output) {
  return readJson(output);
}

export async function runPipeline(config, { date, resume = false, rerun = "" } = {}, dependencies = {}) {
  const generateImage = dependencies.generatePageImage ?? generatePageImage;
  const runDir = path.join(config.dailyRoot, "runs", date);
  const release = await acquireDateLock(runDir);
  let state;
  let mainError;
  try {
    state = await loadOrCreateState(runDir, date);
    if (rerun) invalidateFrom(state, rerun);
    await saveState(runDir, state);
    const characterReference = config.mock ? null : await loadCharacterReference(config);

    const topicOutput = await runStage({ state, stage: "topic", input: { date, model: config.textModel }, runDir, resume, action: async () => {
      const history = await readHistory(config.dailyRoot);
      const attempts = Math.min(3, Math.max(1, config.maxTextCalls - state.counters.text - 1));
      for (let index = 1; index <= attempts; index += 1) {
        const directory = path.join(runDir, "ai", `topic-${index}`);
        const topic = await callStructuredText({ config, state, stageDir: directory, system: systemPrompt, prompt: `为 ${date} 生成一个不重复的治愈情侣日常主题。最近历史：${JSON.stringify(history.slice(-20))}`, validate: validateTopic, mockValue: mockTopic(date), checkpoint: () => saveState(runDir, state) });
        const duplicate = findDuplicate(topic, history, state.runId);
        if (!duplicate.duplicate) {
          const output = path.join(directory, "normalized.json");
          return output;
        }
        state.rejectedTopics.push({ topic: topic.title, reason: duplicate.reason });
      }
      throw new PipelineError("no unique topic passed deterministic history checks", { category: "quality" });
    } });
    const topic = await loadTopic(topicOutput);

    const episodeOutput = await runStage({ state, stage: "episode", input: { topic, model: config.textModel }, runDir, resume, action: async (attempt) => {
      const directory = path.join(runDir, "ai", `episode-${attempt}`);
      await callStructuredText({ config, state, stageDir: directory, system: systemPrompt, prompt: `将主题扩写成封面加 4–6 页双格漫画，严格提供页面、气泡与发布文案 JSON：${JSON.stringify(topic)}`, validate: validateEpisode, mockValue: mockEpisode(date, topic), checkpoint: () => saveState(runDir, state) });
      return path.join(directory, "normalized.json");
    } });
    const episode = await loadEpisode(episodeOutput);
    const episodeDir = path.join(config.dailyRoot, "episodes", `${date}-${episode.slug.replace(/[^a-zA-Z0-9-]/g, "-")}`);
    await mkdir(episodeDir, { recursive: true });
    await writeFile(path.join(episodeDir, "episode.json"), `${JSON.stringify(episode, null, 2)}\n`, { flag: "wx", mode: 0o600 }).catch((error) => {
      if (error.code !== "EEXIST") throw error;
    });

    const images = await runStage({ state, stage: "images", input: { episode: digest(episode), model: config.imageModel, characterReference: characterReference?.digest ?? "mock" }, runDir, resume, action: async (attempt, stageState) => {
      const files = { ...(stageState.output || {}) };
      for (const page of episode.pages) {
        if (files[page.number]) continue;
        const file = attemptFile(path.join(episodeDir, "raw"), page.number, "png", attempt);
        await generateImage({ config, state, page, output: file, characterReference, checkpoint: () => saveState(runDir, state) });
        files[page.number] = file;
        stageState.output = files;
        await saveState(runDir, state);
      }
      return files;
    } });

    const overlays = await runStage({ state, stage: "overlays", input: { episode: digest(episode) }, runDir, resume, action: async (attempt, stageState) => {
      const files = { ...(stageState.output || {}) };
      for (const page of episode.pages) {
        if (files[page.number]) continue;
        const file = attemptFile(path.join(episodeDir, "overlays"), page.number, "svg", attempt);
        await writeOverlay(file, page, episode.title);
        files[page.number] = file;
        stageState.output = files;
        await saveState(runDir, state);
      }
      return files;
    } });

    const renders = await runStage({ state, stage: "renders", input: { images, overlays }, runDir, resume, action: async (attempt, stageState) => {
      const files = { ...(stageState.output || {}) };
      for (const page of episode.pages) {
        if (files[page.number]) continue;
        const file = attemptFile(path.join(episodeDir, "output"), page.number, "png", attempt);
        await mkdir(path.dirname(file), { recursive: true });
        if (config.mock) await copyFile(images[page.number], file);
        else await execFileAsync(path.join(config.contentRoot, "tools", "render-page.sh"), [images[page.number], overlays[page.number], file], { timeout: config.requestTimeoutMs });
        files[page.number] = file;
        stageState.output = files;
        await saveState(runDir, state);
      }
      return files;
    } });

    await runStage({ state, stage: "quality", input: { renders, overlays, episode: digest(episode) }, runDir, resume, action: async () => {
      const quality = await runQualityChecks(episode, episodeDir, { renders, overlays });
      const file = path.join(episodeDir, "quality.json");
      await writeFile(file, `${JSON.stringify(quality, null, 2)}\n`, { mode: 0o600 });
      if (quality.automatic.some((check) => !check.passed)) throw new PipelineError("automatic quality checks failed", { category: "quality", recoverable: true });
      return file;
    } });
    await appendHistory(config.dailyRoot, { date, runId: state.runId, fingerprint: topicFingerprint(topic), topic });

    if (!config.enableXhsDraft) {
      state.stages.xhsDraft.status = "skipped";
      state.stages.xhsDraft.output = "disabled by configuration";
      await saveState(runDir, state);
    } else {
      try {
        await runStage({ state, stage: "xhsDraft", input: { renders, copy: episode.publish }, runDir, resume, action: () => saveDraft({ config, episode, imageFiles: episode.pages.map((page) => renders[page.number]), runDir }) });
      } catch (error) {
        state.result = "partial_failure";
        mainError = error;
      }
    }
    if (!mainError) state.result = "success";
  } catch (error) {
    mainError = error;
    if (state) state.result = "failed";
  }

  try {
    if (state) {
      try {
        await runStage({ state, stage: "notification", input: { result: state.result, stages: Object.fromEntries(STAGES.filter((name) => name !== "notification").map((name) => [name, state.stages[name].status])) }, runDir, resume: true, action: () => sendNotification(config, state, runDir) });
      } catch {}
      const failed = Object.entries(state.stages).filter(([, stage]) => stage.status === "failed").map(([name]) => name);
      const report = `# 每日漫画运行报告\n\n- 日期：${state.date}\n- 运行 ID：${state.runId}\n- 结果：${state.result}\n- 审核状态：待审核\n- 失败阶段：${failed.length ? failed.join("、") : "无"}\n- 草稿：${state.stages.xhsDraft.status}\n\n自动检查不能替代人工终审。请检查角色、肢体、气泡指向、中文和画面连续性后，再由用户手动决定是否发布。\n`;
      await writeFile(path.join(runDir, "report.md"), report, { mode: 0o600 });
      await saveState(runDir, state);
    }
    if (mainError && state?.result !== "partial_failure") throw mainError;
    return state;
  } finally {
    await release();
  }
}
