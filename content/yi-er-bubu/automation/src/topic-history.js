import { appendFile, mkdir, open, readFile, rm } from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import { PipelineError } from "./errors.js";

function normalize(text) {
  return text.normalize("NFKC").toLocaleLowerCase("zh-CN").replace(/[\p{P}\p{S}\s]/gu, "");
}

export function topicFingerprint(topic) {
  const key = [topic.column, topic.title, topic.scene, topic.conflict, topic.ending].map(normalize).join("|");
  return crypto.createHash("sha256").update(key).digest("hex");
}

export async function readHistory(dailyRoot) {
  const file = path.join(dailyRoot, "history", "topics.jsonl");
  try {
    const entries = (await readFile(file, "utf8")).split("\n").filter(Boolean).map((line) => JSON.parse(line));
    return [...new Map(entries.map((entry) => [entry.runId, entry])).values()];
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

export function findDuplicate(topic, history, runId = "") {
  history = history.filter((entry) => entry.runId !== runId);
  const fingerprint = topicFingerprint(topic);
  const exact = history.find((entry) => entry.fingerprint === fingerprint);
  if (exact) return { duplicate: true, reason: `deterministic fingerprint matches ${exact.date}`, fingerprint };
  const keywords = new Set(topic.keywords.map(normalize));
  const similar = history.find((entry) => {
    const prior = new Set((entry.topic?.keywords ?? []).map(normalize));
    return [...keywords].filter((item) => prior.has(item)).length >= Math.min(3, keywords.size);
  });
  return similar
    ? { duplicate: true, reason: `keyword overlap with ${similar.date}`, fingerprint }
    : { duplicate: false, reason: "", fingerprint };
}

export async function appendHistory(dailyRoot, entry) {
  const directory = path.join(dailyRoot, "history");
  await mkdir(directory, { recursive: true });
  const lockFile = path.join(directory, ".topics.lock");
  let handle;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      handle = await open(lockFile, "wx", 0o600);
      break;
    } catch (error) {
      if (error.code !== "EEXIST" || attempt === 19) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  try {
    const current = await readHistory(dailyRoot);
    const sameRun = current.find((item) => item.runId === entry.runId);
    if (sameRun?.fingerprint === entry.fingerprint) return;
    const collision = current.find((item) => item.fingerprint === entry.fingerprint && item.runId !== entry.runId);
    if (collision) throw new PipelineError(`topic was accepted concurrently by ${collision.date}`, { category: "quality", recoverable: true });
    await appendFile(path.join(directory, "topics.jsonl"), `${JSON.stringify(entry)}\n`, { mode: 0o600 });
  } finally {
    await handle?.close();
    await rm(lockFile, { force: true });
  }
}
